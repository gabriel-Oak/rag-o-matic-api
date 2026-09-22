import type { IHttpService } from "../http-service/types.js";
import type { ILoggerService } from "../logger/types.js";
import OllamaService from "./ollama-service.js";
import type { IOllamaService } from "./types.js";

export function createOllamaService(
  httpService: IHttpService,
  logger: ILoggerService
): IOllamaService {
  return new OllamaService(httpService, logger);
}
