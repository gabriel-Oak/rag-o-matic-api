import { getEnv } from "../../../utils/env.js";
import HttpError from "../../../utils/errors/http-error.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IAIService } from "../../../utils/services/ai/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import { buildPoints } from "../utils/build-vector-points.js";
import { chunkMarkdown } from "../utils/chunk-markdown.js";
import { extractText } from "../utils/extract-text.js";
import { splitFrontmatter } from "../utils/split-frontmatter.js";
import type { IndexRequest, IndexResult } from "../models/types.js";

export default class IndexContentUsecase {
  constructor(
    private readonly aiService: IAIService,
    private readonly qdrantService: IVectorDatabaseService,
    private readonly logger: ILoggerService
  ) {}

  async execute(req: IndexRequest): Promise<Either<HttpError, IndexResult>> {
    const bytes = Buffer.from(req.content, "base64");

    const extracted = await extractText(req.type, bytes);
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

    const chunks = chunkMarkdown(body, req.chunking);
    if (chunks.length === 0) {
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

    const inputs = chunks.map((chunk) =>
      frontmatter ? frontmatter + "\n\n" + chunk.content : chunk.content
    );

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
      chunks: chunks.map((chunk) => ({
        content: chunk.content,
        headings: chunk.headings,
      })),
      embeddings: embeddings.success,
      frontmatter,
      indexedAt,
    });

    const ensured = await this.qdrantService.ensureCollection();
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

    const deleted = await this.qdrantService.deletePointsByFilter({
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

    const upserted = await this.qdrantService.upsertPoints(points);
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
      chunkCount: chunks.length,
      upserted: points.length,
    });

    const result: IndexResult = {
      source: req.source,
      type: req.type,
      model: getEnv().OLLAMA_EMBEDDING_MODEL,
      chunkCount: chunks.length,
      upserted: points.length,
    };

    return new Right(result);
  }
}
