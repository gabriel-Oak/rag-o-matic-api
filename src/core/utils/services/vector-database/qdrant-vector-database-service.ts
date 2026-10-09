import { QdrantClient } from "@qdrant/js-client-rest";
import type { Schemas } from "@qdrant/js-client-rest";
import { getEnv } from "../../env.js";
import type { Either } from "../../types.js";
import { Left, Right } from "../../types.js";
import type { ILoggerService } from "../logger/types.js";
import type {
  IVectorDatabaseService,
  VectorPoint,
  VectorSearchHit,
} from "./types.js";
import { VectorDatabaseError } from "./types.js";

type QdrantClientWithClose = QdrantClient & {
  close?: () => Promise<void>;
};

export default class QdrantVectorDatabaseService
  implements IVectorDatabaseService
{
  private client?: QdrantClient;

  constructor(
    private readonly logger: ILoggerService,
    client?: QdrantClient
  ) {
    if (client) {
      this.client = client;
    }
  }

  private getClient(): QdrantClient {
    if (!this.client) {
      const { QDRANT_URL, QDRANT_API_KEY } = getEnv();
      // The qdrant-js `url` param drops default ports (new URL().port is "" for
      // https:443), silently falling back to :6333. Pass host/port/https
      // explicitly so https endpoints on 443 (e.g. behind a TLS proxy) work.
      const parsed = new URL(QDRANT_URL);
      this.client = new QdrantClient({
        host: parsed.hostname,
        port:
          Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 6333),
        https: parsed.protocol === "https:",
        ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
      });
    }
    return this.client;
  }

  async ensureCollection(): Promise<Either<VectorDatabaseError, void>> {
    const { QDRANT_COLLECTION, QDRANT_DIMENSION } = getEnv();

    try {
      const collection = await this.getClient().getCollection(
        QDRANT_COLLECTION
      );

      const sparseVectors = collection.config.params.sparse_vectors;
      if (!sparseVectors || !sparseVectors.text) {
        const error = new VectorDatabaseError(
          `collection ${QDRANT_COLLECTION} exists without sparse config — rename QDRANT_COLLECTION or drop it`
        );
        this.logger.error(error.message, error);
        return new Left(error);
      }

      return new Right(undefined);
    } catch (e) {
      if (!this.isCollectionNotFound(e)) {
        const error = new VectorDatabaseError(
          "Failed to get Qdrant collection",
          {
          collection: QDRANT_COLLECTION,
          error: e,
        });
        this.logger.error(error.message, error);
        return new Left(error);
      }

      try {
        await this.getClient().createCollection(
          QDRANT_COLLECTION,
          {
            vectors: { size: QDRANT_DIMENSION, distance: "Cosine" },
            sparse_vectors: {
              text: { data_type: "float32", modifier: "idf" },
            },
          } as Schemas["CreateCollection"],
        );
        return new Right(undefined);
      } catch (createError) {
        const error = new VectorDatabaseError(
          "Failed to create Qdrant collection",
          {
          collection: QDRANT_COLLECTION,
          error: createError,
        });
        this.logger.error(error.message, error);
        return new Left(error);
      }
    }
  }

  async upsertPoints(
    points: VectorPoint[]
  ): Promise<Either<VectorDatabaseError, void>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      await this.getClient().upsert(QDRANT_COLLECTION, {
        points: points.map(
          (point) =>
            ({
              id: point.id,
              vector: point.vector,
              payload: point.payload,
              ...(point.sparse
                ? { sparse_vectors: { text: point.sparse } }
                : {}),
            }) as Schemas["PointStruct"],
        ),
      });
      return new Right(undefined);
    } catch (e) {
      const error = new VectorDatabaseError("Failed to upsert points to Qdrant", {
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
  ): Promise<Either<VectorDatabaseError, VectorSearchHit[]>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      const response = await this.getClient().query(QDRANT_COLLECTION, {
        query: vector,
        limit,
        with_payload: true,
      });

      return new Right(this.toSearchHits(response.points));
    } catch (e) {
      const error = new VectorDatabaseError(
        "Failed to query points from Qdrant",
        {
        collection: QDRANT_COLLECTION,
        error: e,
      });
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async queryHybrid(
    dense: number[],
    sparse: Array<{ index: number; value: number }>,
    limit: number,
    filter?: Record<string, unknown>
  ): Promise<Either<VectorDatabaseError, VectorSearchHit[]>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      const response = await this.getClient().query(
        QDRANT_COLLECTION,
        {
          query: { fusion: "rrf" },
          prefetch: [
            { vector: dense },
            { sparse: { key: "text", vector: sparse } },
          ],
          limit,
          with_payload: true,
          ...(filter ? { filter } : {}),
        } as Schemas["QueryRequest"],
      );

      return new Right(this.toSearchHits(response.points));
    } catch (e) {
      const error = new VectorDatabaseError(
        "Failed to run hybrid query on Qdrant",
        {
          collection: QDRANT_COLLECTION,
          error: e,
        },
      );
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async listSources(
    prefix?: string
  ): Promise<
    Either<VectorDatabaseError, Array<{ source: string; chunks: number }>>
  > {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      const response = await this.getClient().queryGroups(QDRANT_COLLECTION, {
        group_by: "source",
        group_size: 1,
        limit: 1000,
        with_payload: false,
        ...(prefix
          ? { filter: { must: [{ key: "source", match: { prefix } }] } }
          : {}),
      });

      return new Right(
        (response.groups ?? []).map((group) => ({
          source: String(group.id),
          chunks: group.hits.length,
        })),
      );
    } catch (e) {
      const error = new VectorDatabaseError(
        "Failed to list sources from Qdrant",
        {
          collection: QDRANT_COLLECTION,
          error: e,
        },
      );
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async deletePointsByFilter(
    filter: Record<string, unknown>
  ): Promise<Either<VectorDatabaseError, void>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      await this.getClient().delete(QDRANT_COLLECTION, {
        filter: filter as Schemas["Filter"],
      });
      return new Right(undefined);
    } catch (e) {
      const error = new VectorDatabaseError(
        "Failed to delete points from Qdrant",
        {
        collection: QDRANT_COLLECTION,
        error: e,
      });
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async countPointsByFilter(
    filter: Record<string, unknown>
  ): Promise<Either<VectorDatabaseError, number>> {
    const { QDRANT_COLLECTION } = getEnv();

    try {
      const res = await this.getClient().count(QDRANT_COLLECTION, {
        filter: filter as Schemas["Filter"],
        exact: true,
      });
      return new Right(res.count);
    } catch (e) {
      const error = new VectorDatabaseError(
        "Failed to count points in Qdrant",
        {
        collection: QDRANT_COLLECTION,
        error: e,
      });
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  async close(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client as QdrantClientWithClose;
    if (typeof client.close === "function") {
      await client.close();
    }
  }

  private isCollectionNotFound(e: unknown): boolean {
    return e instanceof Error && /not found/i.test(e.message);
  }

  private toSearchHits(
    points: Schemas["ScoredPoint"][] | undefined
  ): VectorSearchHit[] {
    return (points ?? []).map((entry) => ({
      score: entry.score,
      point: {
        id: String(entry.id),
        vector: this.toVector(entry.vector),
        payload: entry.payload ?? {},
      },
    }));
  }

  private toVector(value: unknown): number[] {
    if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
      return value as number[];
    }
    return [];
  }
}
