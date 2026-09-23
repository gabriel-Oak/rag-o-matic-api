import type { FastifyRequest } from "fastify";
import controller from "../../../utils/controller/decorators/controller.js";
import post from "../../../utils/controller/decorators/post.js";
import HttpError from "../../../utils/errors/http-error.js";
import { indexRequestSchema } from "../models/types.js";
import type IndexContentUsecase from "../usecases/index-content.usecase.js";

@controller("/index")
export default class IndexController {
  constructor(private readonly indexContent: IndexContentUsecase) {}

  @post("/")
  async index(req: FastifyRequest) {
    const parsed = indexRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError({
        message: "invalid request body",
        statusCode: 400,
        meta: parsed.error.issues,
      });
    }

    const result = await this.indexContent.execute(parsed.data);
    if (result.isError) {
      throw result.error;
    }

    return result.success;
  }
}
