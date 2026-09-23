import type { Either } from "../../types.js";
import BaseError from "../../errors/base-error.js";

export class QdrantError extends BaseError {
  readonly type = "qdrant-error";
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QdrantSearchHit {
  score: number;
  point: QdrantPoint;
}

export interface IQdrantService {
  ensureCollection(): Promise<Either<QdrantError, void>>;
  upsertPoints(
    points: QdrantPoint[]
  ): Promise<Either<QdrantError, void>>;
  queryPoints(
    vector: number[],
    limit: number
  ): Promise<Either<QdrantError, QdrantSearchHit[]>>;
  deletePointsByFilter(
    filter: Record<string, unknown>
  ): Promise<Either<QdrantError, void>>;
  close(): Promise<void>;
}
