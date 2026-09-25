import type { IHttpService } from "../http-service/types.js";
import type { ILoggerService } from "../logger/types.js";
import OllamaAiService from "./ollama-ai-service.js";
import type { IAIService } from "./types.js";

export function createAIService(
  httpService: IHttpService,
  logger: ILoggerService
): IAIService {
  return new OllamaAiService(httpService, logger);
}
