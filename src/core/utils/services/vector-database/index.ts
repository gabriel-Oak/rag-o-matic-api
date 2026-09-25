import type { QdrantClient } from "@qdrant/js-client-rest";
import type { ILoggerService } from "../logger/types.js";
import QdrantVectorDatabaseService from "./qdrant-vector-database-service.js";
import type { IVectorDatabaseService } from "./types.js";

export function createVectorDatabaseService(
  logger: ILoggerService,
  client?: QdrantClient
): IVectorDatabaseService {
  return new QdrantVectorDatabaseService(logger, client);
}
