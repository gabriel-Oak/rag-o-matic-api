import { describe, expect, it, vi } from "vitest";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IVectorDatabaseService } from "../../../utils/services/vector-database/types.js";
import { VectorDatabaseError } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import ListSourcesUsecase from "./list-sources-usecase.js";

function fakeLogger(): ILoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type ListOptions = {
  sources?: Array<{ source: string; chunks: number }>;
  listError?: VectorDatabaseError;
};

function makeQdrant(options: ListOptions = {}) {
  const prefixes: Array<string | undefined> = [];

  const service: IVectorDatabaseService = {
    ensureCollection: vi.fn(async () => new Right(undefined)),
    upsertPoints: vi.fn(async () => new Right(undefined)),
    queryPoints: vi.fn(async () => new Right([])),
    countPointsByFilter: vi.fn(async () => new Right(0)),
    deletePointsByFilter: vi.fn(async () => new Right(undefined)),
    listSources: vi.fn(async (prefix?: string) => {
      prefixes.push(prefix);
      if (options.listError) return new Left(options.listError);
      return new Right(options.sources ?? []);
    }),
    close: vi.fn(async () => undefined),
  };

  return { service, prefixes };
}

function makeUsecase(options: ListOptions = {}) {
  const qdrant = makeQdrant(options);
  const logger = fakeLogger();
  const usecase = new ListSourcesUsecase(qdrant.service, logger);

  return { usecase, logger, qdrant };
}

describe("ListSourcesUsecase.execute", () => {
  it("returns Right with sources and count", async () => {
    const sources = [
      { source: "Projetos/note.md", chunks: 3 },
      { source: "Projetos/other.md", chunks: 1 },
    ];
    const { usecase, logger, qdrant } = makeUsecase({ sources });

    const result = await usecase.execute();

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({ sources, count: 2 });
    expect(qdrant.prefixes).toEqual([undefined]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("propagates the prefix to the service", async () => {
    const { usecase, qdrant } = makeUsecase({
      sources: [{ source: "Projetos/note.md", chunks: 2 }],
    });

    const result = await usecase.execute("Projetos/");

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({
      sources: [{ source: "Projetos/note.md", chunks: 2 }],
      count: 1,
    });
    expect(qdrant.prefixes).toEqual(["Projetos/"]);
  });

  it("returns an empty list when there are no sources", async () => {
    const { usecase } = makeUsecase();

    const result = await usecase.execute();

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({ sources: [], count: 0 });
  });

  it("returns Left(HttpError 502) when listSources fails", async () => {
    const { usecase, logger } = makeUsecase({
      listError: new VectorDatabaseError("boom"),
    });

    const result = await usecase.execute("Projetos/");

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to list sources");
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
  });
});
