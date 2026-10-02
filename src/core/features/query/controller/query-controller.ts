import type { FastifyRequest } from "fastify";
import controller from "../../../utils/controller/decorators/controller.js";
import get from "../../../utils/controller/decorators/get.js";
import HttpError from "../../../utils/errors/http-error.js";
import { queryRequestSchema } from "../models/types.js";
import type QueryContentUsecase from "../usecases/query-content-usecase.js";

@controller("/query")
export default class QueryController {
  constructor(private readonly queryContent: QueryContentUsecase) {}

  @get("/")
  async query(req: FastifyRequest) {
    const parsed = queryRequestSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError({
        message: "invalid query params",
        statusCode: 400,
        meta: parsed.error.issues,
      });
    }

    const result = await this.queryContent.execute(parsed.data);
    if (result.isError) {
      throw result.error;
    }

    return result.success;
  }
}
