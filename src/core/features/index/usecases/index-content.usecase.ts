import { getEnv } from "../../../utils/env.js";
import HttpError from "../../../utils/errors/http-error.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IOllamaService } from "../../../utils/services/ollama/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import { chunkMarkdown } from "../chunk-markdown.js";
import { extractText } from "../extract-text.js";
import { splitFrontmatter } from "../split-frontmatter.js";
import type { IndexRequest, IndexResult } from "../models/types.js";

export default class IndexContentUsecase {
  constructor(
    private readonly ollamaService: IOllamaService,
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

    const embeddings = await this.ollamaService.embed(inputs);
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

    const result: IndexResult = {
      ...(req.source ? { source: req.source } : {}),
      type: req.type,
      model: getEnv().OLLAMA_EMBEDDING_MODEL,
      chunkCount: chunks.length,
      chunks: chunks.map((chunk, index) => ({
        index,
        headings: chunk.headings,
        content: chunk.content,
        charCount: chunk.content.length,
        metadata: frontmatter ? { frontmatter } : {},
        embedding: embeddings.success[index],
      })),
    };

    return new Right(result);
  }
}
