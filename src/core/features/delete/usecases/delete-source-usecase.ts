import HttpError from "../../../utils/errors/http-error.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import type { DeleteSourceResult } from "../models/types.js";

export default class DeleteSourceUsecase {
  constructor(
    private readonly vectorDatabaseService: IVectorDatabaseService,
    private readonly logger: ILoggerService
  ) {}

  async execute(
    source: string
  ): Promise<Either<HttpError, DeleteSourceResult>> {
    const filter = {
      must: [{ key: "source", match: { value: source } }],
    };

    const counted =
      await this.vectorDatabaseService.countPointsByFilter(filter);
    if (counted.isError) {
      this.logger.error("delete-source: failed to count points for source", {
        source,
        error: counted.error,
      });
      return new Left(
        new HttpError({
          message: "failed to count points for source",
          statusCode: 502,
          meta: counted.error,
        })
      );
    }

    const deleted =
      await this.vectorDatabaseService.deletePointsByFilter(filter);
    if (deleted.isError) {
      this.logger.error("delete-source: failed to delete points for source", {
        source,
        error: deleted.error,
      });
      return new Left(
        new HttpError({
          message: "failed to delete points for source",
          statusCode: 502,
          meta: deleted.error,
        })
      );
    }

    const result: DeleteSourceResult = {
      source,
      deleted: counted.success,
    };

    this.logger.info("delete-source: source deleted", {
      source,
      deleted: result.deleted,
    });

    return new Right(result);
  }
}
