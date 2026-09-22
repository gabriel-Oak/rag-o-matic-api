import { QdrantClient } from "@qdrant/js-client-rest";
import { getEnv } from "../../env.js";
import type { Either } from "../../types.js";
import { Left, Right } from "../../types.js";
import type { ILoggerService } from "../logger/types.js";
import type { IQdrantService, QdrantPoint, QdrantSearchHit } from "./types.js";
import { QdrantError } from "./types.js";

type QdrantClientWithClose = QdrantClient & {
  close?: () => Promise<void>;
};

export default class QdrantService implements IQdrantService {
  private readonly client: QdrantClient;

  constructor(
    private readonly logger: ILoggerService,
    client?: QdrantClient
  ) {
    if (client) {
      this.client = client;
      return;
    }

    const { QDRANT_URL, QDRANT_API_KEY } = getEnv();
    this.client = new QdrantClient({
      url: QDRANT_URL,
      ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
    });
  }

  async ensureCollection(): Promise<Either<QdrantError, void>> {
    const { QDRANT_COLLECTION, QDRANT_DIMENSION } = getEnv();

    try {
      await this.client.getCollection(QDRANT_COLLECTION);
      return new Right(undefined);
    } catch (e) {
      if (!this.isCollectionNotFound(e)) {
        const error = new QdrantError("Failed to get Qdrant collection", {
          collection: QDRANT_COLLECTION,
          error: e,
        });
        this.logger.error(error.message, error);
        return new Left(error);
      }

      try {
        await this.client.createCollection(QDRANT_COLLECTION, {
          vectors: { size: QDRANT_DIMENSION, distance: "Cosine" },
        });
        return new Right(undefined);
      } catch (createError) {
        const error = new QdrantError("Failed to create Qdrant collection", {
          collection: QDRANT_COLLECTION,
          error: createError,
        });
        this.logger.error(error.message, error);
        return new Left(error);
      }
    }
  }

  async upsertPoints(
    points: QdrantPoint[]
  ): Promise<Either<QdrantError, void>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      await this.client.upsert(QDRANT_COLLECTION, {
        points: points.map((point) => ({
          id: point.id,
          vector: point.vector,
          payload: point.payload,
        })),
      });
      return new Right(undefined);
    } catch (e) {
      const error = new QdrantError("Failed to upsert points to Qdrant", {
        collection: QDRANT_COLLECTION,
        error: e,
      });
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async queryPoints(
    vector: number[],
    limit: number
  ): Promise<Either<QdrantError, QdrantSearchHit[]>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      const response = await this.client.query(QDRANT_COLLECTION, {
        query: vector,
        limit,
        with_payload: true,
      });

      const hits: QdrantSearchHit[] = (response.points ?? []).map(
        (entry) => ({
          score: entry.score,
          point: {
            id: String(entry.id),
            vector: this.toVector(entry.vector),
            payload: entry.payload ?? {},
          },
        })
      );

      return new Right(hits);
    } catch (e) {
      const error = new QdrantError("Failed to query points from Qdrant", {
        collection: QDRANT_COLLECTION,
        error: e,
      });
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async close(): Promise<void> {
    const client = this.client as QdrantClientWithClose;
    if (typeof client.close === "function") {
      await client.close();
    }
  }

  private isCollectionNotFound(e: unknown): boolean {
    return e instanceof Error && /not found/i.test(e.message);
  }

  private toVector(value: unknown): number[] {
    if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
      return value as number[];
    }
    return [];
  }
}
