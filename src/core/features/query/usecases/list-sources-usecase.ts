import HttpError from "../../../utils/errors/http-error.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import type { ListSourcesResult } from "../models/types.js";

export default class ListSourcesUsecase {
  constructor(
    private readonly vectorDatabaseService: IVectorDatabaseService,
    private readonly logger: ILoggerService
  ) {}

  async execute(
    prefix?: string
  ): Promise<Either<HttpError, ListSourcesResult>> {
    const listed = await this.vectorDatabaseService.listSources(prefix);
    if (listed.isError) {
      this.logger.error("list-sources: failed to list sources", {
        prefix,
        error: listed.error,
      });
      return new Left(
        new HttpError({
          message: "failed to list sources",
          statusCode: 502,
          meta: listed.error,
        })
      );
    }

    const result: ListSourcesResult = {
      sources: listed.success,
      count: listed.success.length,
    };

    this.logger.info("list-sources: sources listed", {
      prefix,
      count: result.count,
    });

    return new Right(result);
  }
}
