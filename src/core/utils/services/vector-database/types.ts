import type { Either } from "../../types.js";
import BaseError from "../../errors/base-error.js";

export class VectorDatabaseError extends BaseError {
  readonly type = "vector-database-error";
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface VectorSearchHit {
  score: number;
  point: VectorPoint;
}

export interface IVectorDatabaseService {
  ensureCollection(): Promise<Either<VectorDatabaseError, void>>;
  upsertPoints(
    points: VectorPoint[]
  ): Promise<Either<VectorDatabaseError, void>>;
  queryPoints(
    vector: number[],
    limit: number
  ): Promise<Either<VectorDatabaseError, VectorSearchHit[]>>;
  deletePointsByFilter(
    filter: Record<string, unknown>
  ): Promise<Either<VectorDatabaseError, void>>;
  close(): Promise<void>;
}
