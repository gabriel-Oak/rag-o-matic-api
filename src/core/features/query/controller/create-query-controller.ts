import { createAIService } from "../../../utils/services/ai/index.js";
import { createHttpService } from "../../../utils/services/http-service/index.js";
import createLoggerService from "../../../utils/services/logger/index.js";
import { createVectorDatabaseService } from "../../../utils/services/vector-database/index.js";
import QueryContentUsecase from "../usecases/query-content-usecase.js";
import QueryController from "./query-controller.js";

export default function createQueryController() {
  const logger = createLoggerService();
  const httpService = createHttpService();
  const aiService = createAIService(httpService, logger);
  const vectorDatabaseService = createVectorDatabaseService(logger);
  const queryContent = new QueryContentUsecase(
    aiService,
    vectorDatabaseService,
    logger
  );

  return new QueryController(queryContent);
}
