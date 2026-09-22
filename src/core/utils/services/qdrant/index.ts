import type { QdrantClient } from "@qdrant/js-client-rest";
import type { ILoggerService } from "../logger/types.js";
import QdrantService from "./qdrant-service.js";
import type { IQdrantService } from "./types.js";

export function createQdrantService(
  logger: ILoggerService,
  client?: QdrantClient
): IQdrantService {
  return new QdrantService(logger, client);
}
