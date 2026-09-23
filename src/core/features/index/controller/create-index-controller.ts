import { createHttpService } from "../../../utils/services/http-service/index.js";
import createLoggerService from "../../../utils/services/logger/index.js";
import OllamaService from "../../../utils/services/ollama/ollama-service.js";
import IndexContentUsecase from "../usecases/index-content.usecase.js";
import IndexController from "./index-controller.js";

export default function createIndexController() {
  const logger = createLoggerService();
  const httpService = createHttpService();
  const ollamaService = new OllamaService(httpService, logger);
  const indexContent = new IndexContentUsecase(ollamaService, logger);

  return new IndexController(indexContent);
}
