import { getEnv } from "../../../utils/env.js";
import HttpError from "../../../utils/errors/http-error.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IAIService } from "../../../utils/services/ai/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import { buildMetadataChunk } from "../utils/build-metadata-chunk.js";
import { buildPoints } from "../utils/build-vector-points.js";
import {
  DEFAULT_MAX_CHUNK_CHARS,
  chunkMarkdown,
} from "../utils/chunk-markdown.js";
import { extractText } from "../utils/extract-text.js";
import { buildSparseVector } from "../utils/sparse-tf.js";
import { splitFrontmatter } from "../utils/split-frontmatter.js";
import type { IndexRequest, IndexResult } from "../models/types.js";

export default class IndexContentUsecase {
  constructor(
    private readonly aiService: IAIService,
    private readonly vectorDatabaseService: IVectorDatabaseService,
    private readonly logger: ILoggerService
  ) {}

  async execute(req: IndexRequest): Promise<Either<HttpError, IndexResult>> {
    const bytes = Buffer.from(req.content, "base64");

    const extracted = await extractText(req.type, bytes, this.logger);
    if (extracted.isError) {
      this.logger.error("index-content: failed to extract text", {
        type: req.type,
        source: req.source,
        error: extracted.error,
      });
      return new Left(
        new HttpError({
          message: extracted.error.message,
          statusCode: 422,
          meta: extracted.error,
        })
      );
    }

    const { frontmatter, body } = splitFrontmatter(extracted.success);

    const maxChunkChars =
      req.chunking?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
    const chunks = chunkMarkdown(body, {
      ...req.chunking,
      contextLines: [req.source],
    });
    const metadataChunks = buildMetadataChunk({
      frontmatter: frontmatter ?? "",
      source: req.source,
      maxChunkChars,
    });
    const finalChunks = [...metadataChunks, ...chunks];
    if (finalChunks.length === 0) {
      this.logger.warn("index-content: no chunks produced", {
        type: req.type,
        source: req.source,
      });
      return new Left(
        new HttpError({
          message: "no chunks produced from the provided content",
          statusCode: 400,
        })
      );
    }

    const inputs = finalChunks.map((chunk) => chunk.content);
    const sparse = finalChunks.map((chunk) => buildSparseVector(chunk.content));

    const embeddings = await this.aiService.embed(inputs);
    if (embeddings.isError) {
      this.logger.error("index-content: failed to embed chunks", {
        type: req.type,
        source: req.source,
        error: embeddings.error,
      });
      return new Left(
        new HttpError({
          message: "failed to embed content",
          statusCode: 502,
          meta: embeddings.error,
        })
      );
    }

    const expectedDimension = getEnv().QDRANT_DIMENSION;
    for (const vector of embeddings.success) {
      if (vector.length !== expectedDimension) {
        this.logger.error("index-content: embedding dimension mismatch", {
          source: req.source,
          expected: expectedDimension,
          got: vector.length,
        });
        return new Left(
          new HttpError({
            message: `embedding dimension mismatch (expected ${expectedDimension}, got ${vector.length})`,
            statusCode: 422,
          })
        );
      }
    }

    const indexedAt = new Date().toISOString();
    const points = buildPoints({
      source: req.source,
      type: req.type,
      chunks: finalChunks.map((chunk) => ({
        content: chunk.content,
        headings: chunk.headings,
      })),
      embeddings: embeddings.success,
      frontmatter,
      indexedAt,
      sparse,
      metadataCount: metadataChunks.length,
    });

    const ensured = await this.vectorDatabaseService.ensureCollection();
    if (ensured.isError) {
      this.logger.error("index-content: failed to ensure Qdrant collection", {
        source: req.source,
        error: ensured.error,
      });
      return new Left(
        new HttpError({
          message: "failed to ensure Qdrant collection",
          statusCode: 502,
          meta: ensured.error,
        })
      );
    }

    const deleted = await this.vectorDatabaseService.deletePointsByFilter({
      must: [{ key: "source", match: { value: req.source } }],
    });
    if (deleted.isError) {
      this.logger.error("index-content: failed to delete existing points", {
        source: req.source,
        error: deleted.error,
      });
      return new Left(
        new HttpError({
          message: "failed to delete existing points for source",
          statusCode: 502,
          meta: deleted.error,
        })
      );
    }

    const upserted = await this.vectorDatabaseService.upsertPoints(points);
    if (upserted.isError) {
      this.logger.error("index-content: failed to upsert points", {
        source: req.source,
        error: upserted.error,
      });
      return new Left(
        new HttpError({
          message: "failed to upsert points",
          statusCode: 502,
          meta: upserted.error,
        })
      );
    }

    this.logger.info("index-content: content indexed", {
      source: req.source,
      chunkCount: finalChunks.length,
      metadataChunks: metadataChunks.length,
      upserted: points.length,
    });

    const result: IndexResult = {
      source: req.source,
      type: req.type,
      model: getEnv().OLLAMA_EMBEDDING_MODEL,
      chunkCount: finalChunks.length,
      upserted: points.length,
    };

    return new Right(result);
  }
}
