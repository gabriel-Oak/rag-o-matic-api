import { createAIService } from "../../../utils/services/ai/index.js";
import { createHttpService } from "../../../utils/services/http-service/index.js";
import createLoggerService from "../../../utils/services/logger/index.js";
import { createVectorDatabaseService } from "../../../utils/services/vector-database/index.js";
import IndexContentUsecase from "../usecases/index-content.usecase.js";
import IndexController from "./index-controller.js";

export default function createIndexController() {
  const logger = createLoggerService();
  const httpService = createHttpService();
  const aiService = createAIService(httpService, logger);
  const qdrantService = createVectorDatabaseService(logger);
  const indexContent = new IndexContentUsecase(
    aiService,
    qdrantService,
    logger,
  );

  return new IndexController(indexContent);
}
