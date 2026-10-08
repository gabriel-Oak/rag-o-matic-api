import { describe, expect, it, vi } from "vitest";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { VectorDatabaseError } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import DeleteSourceUsecase from "./delete-source-usecase.js";

function fakeLogger(): ILoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type QdrantOptions = {
  count?: number;
  countError?: VectorDatabaseError;
  deleteError?: VectorDatabaseError;
};

function makeQdrant(options: QdrantOptions = {}) {
  const countFilters: Record<string, unknown>[] = [];
  const deleteFilters: Record<string, unknown>[] = [];

  const service: IVectorDatabaseService = {
    ensureCollection: vi.fn(async () => new Right(undefined)),
    upsertPoints: vi.fn(async () => new Right(undefined)),
    queryPoints: vi.fn(async () => new Right([])),
    countPointsByFilter: vi.fn(async (filter: Record<string, unknown>) => {
      countFilters.push(filter);
      if (options.countError) return new Left(options.countError);
      return new Right(options.count ?? 0);
    }),
    deletePointsByFilter: vi.fn(async (filter: Record<string, unknown>) => {
      deleteFilters.push(filter);
      if (options.deleteError) return new Left(options.deleteError);
      return new Right(undefined);
    }),
    close: vi.fn(async () => undefined),
  };

  return { service, countFilters, deleteFilters };
}

function makeUsecase(options: QdrantOptions = {}) {
  const qdrantFake = makeQdrant(options);
  const logger = fakeLogger();
  const usecase = new DeleteSourceUsecase(qdrantFake.service, logger);

  return { usecase, logger, qdrant: qdrantFake };
}

describe("DeleteSourceUsecase.execute", () => {
  it("deletes all points for the source and returns the count", async () => {
    const { usecase, logger, qdrant } = makeUsecase({ count: 12 });

    const result = await usecase.execute("doc.md");

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({ source: "doc.md", deleted: 12 });

    expect(qdrant.countFilters).toEqual([
      { must: [{ key: "source", match: { value: "doc.md" } }] },
    ]);
    expect(qdrant.deleteFilters).toEqual([
      { must: [{ key: "source", match: { value: "doc.md" } }] },
    ]);
    expect(logger.info).toHaveBeenCalledWith("delete-source: source deleted", {
      source: "doc.md",
      deleted: 12,
    });
  });

  it("is idempotent: source with 0 points still calls delete and returns deleted: 0", async () => {
    const { usecase, logger, qdrant } = makeUsecase();

    const result = await usecase.execute("missing.md");

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({ source: "missing.md", deleted: 0 });

    expect(qdrant.deleteFilters).toEqual([
      { must: [{ key: "source", match: { value: "missing.md" } }] },
    ]);
    expect(logger.info).toHaveBeenCalled();
  });

  it("returns Left(HttpError 502) when countPointsByFilter fails", async () => {
    const { usecase, logger, qdrant } = makeUsecase({
      countError: new VectorDatabaseError("boom"),
    });

    const result = await usecase.execute("doc.md");

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to count points for source");
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.deleteFilters).toHaveLength(0);
  });

  it("returns Left(HttpError 502) when deletePointsByFilter fails", async () => {
    const { usecase, logger, qdrant } = makeUsecase({
      deleteError: new VectorDatabaseError("boom"),
    });

    const result = await usecase.execute("doc.md");

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to delete points for source");
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.countFilters).toHaveLength(1);
  });
});
