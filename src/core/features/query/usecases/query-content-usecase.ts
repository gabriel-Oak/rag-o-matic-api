import { getEnv } from "../../../utils/env.js";
import HttpError from "../../../utils/errors/http-error.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IAIService } from "../../../utils/services/ai/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import type {
  QueryHit,
  QueryRequest,
  QueryResult,
} from "../models/types.js";

export default class QueryContentUsecase {
  constructor(
    private readonly aiService: IAIService,
    private readonly vectorDatabaseService: IVectorDatabaseService,
    private readonly logger: ILoggerService
  ) {}

  async execute(req: QueryRequest): Promise<Either<HttpError, QueryResult>> {
    const embeddings = await this.aiService.embed([req.q]);
    if (embeddings.isError) {
      this.logger.error("query-content: failed to embed query", {
        q: req.q,
        error: embeddings.error,
      });
      return new Left(
        new HttpError({
          message: "failed to embed query",
          statusCode: 502,
          meta: embeddings.error,
        })
      );
    }

    const vector = embeddings.success[0];
    const expectedDimension = getEnv().QDRANT_DIMENSION;
    if (vector.length !== expectedDimension) {
      this.logger.error("query-content: embedding dimension mismatch", {
        q: req.q,
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

    const queried = await this.vectorDatabaseService.queryPoints(
      vector,
      req.limit
    );
    if (queried.isError) {
      this.logger.error("query-content: failed to query points", {
        q: req.q,
        error: queried.error,
      });
      return new Left(
        new HttpError({
          message: "failed to query points",
          statusCode: 502,
          meta: queried.error,
        })
      );
    }

    const results: QueryHit[] = queried.success.map((hit) => ({
      score: hit.score,
      source: hit.point.payload.source as string,
      type: hit.point.payload.type as string,
      chunkIndex: hit.point.payload.chunkIndex as number,
      headings: hit.point.payload.headings as string[],
      content: hit.point.payload.content as string,
      indexedAt: hit.point.payload.indexedAt as string,
    }));

    const count = results.length;
    this.logger.info("query-content: query executed", {
      q: req.q,
      limit: req.limit,
      count,
    });

    const result: QueryResult = {
      query: req.q,
      count,
      results,
    };

    return new Right(result);
  }
}
