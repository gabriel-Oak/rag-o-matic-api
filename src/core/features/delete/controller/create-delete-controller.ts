import createLoggerService from "../../../utils/services/logger/index.js";
import { createVectorDatabaseService } from "../../../utils/services/vector-database/index.js";
import DeleteSourceUsecase from "../usecases/delete-source-usecase.js";
import DeleteController from "./delete-controller.js";

export default function createDeleteController() {
  const logger = createLoggerService();
  const vectorDatabaseService = createVectorDatabaseService(logger);
  const deleteSource = new DeleteSourceUsecase(
    vectorDatabaseService,
    logger,
  );

  return new DeleteController(deleteSource);
}
