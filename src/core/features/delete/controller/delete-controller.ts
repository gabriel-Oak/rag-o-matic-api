import type { FastifyRequest } from "fastify";
import controller from "../../../utils/controller/decorators/controller.js";
import del from "../../../utils/controller/decorators/del.js";
import type DeleteSourceUsecase from "../usecases/delete-source-usecase.js";

@controller("/index")
export default class DeleteController {
  constructor(private readonly deleteSourceUsecase: DeleteSourceUsecase) {}

  @del("/:source")
  async deleteSource(req: FastifyRequest) {
    const source = (req.params as { source: string }).source;
    const result = await this.deleteSourceUsecase.execute(source);
    if (result.isError) {
      throw result.error;
    }

    return result.success;
  }
}
