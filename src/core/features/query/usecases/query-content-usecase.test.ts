import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../utils/env.js";
import { getEnv } from "../../../utils/env.js";
import { AIError, type IAIService } from "../../../utils/services/ai/types.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type {
  IVectorDatabaseService,
  VectorSearchHit,
} from "../../../utils/services/vector-database/types.js";
import { VectorDatabaseError } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { QueryRequest } from "../models/types.js";
import QueryContentUsecase from "./query-content-usecase.js";

vi.mock("../../../utils/env.js", () => ({
  getEnv: vi.fn(),
}));

const env = {
  NODE_ENV: "test",
  PORT: 8080,
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_EMBEDDING_MODEL: "bge-m3",
  QDRANT_URL: "http://localhost:6333",
  QDRANT_COLLECTION: "vault_notes",
  QDRANT_DIMENSION: 1024,
} as Env;

function fakeLogger(): ILoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type QdrantOverrides = Partial<Pick<IVectorDatabaseService, "queryPoints">>;

function makeQdrant(overrides: QdrantOverrides = {}) {
  const service: IVectorDatabaseService = {
    ensureCollection: vi.fn(async () => new Right(undefined)),
    upsertPoints: vi.fn(async () => new Right(undefined)),
    queryPoints: vi.fn(async () => new Right([])),
    deletePointsByFilter: vi.fn(async () => new Right(undefined)),
    close: vi.fn(async () => undefined),
    ...overrides,
  };

  return { service };
}

function makeUsecase(embed: IAIService["embed"], qdrant: QdrantOverrides = {}) {
  const aiService: IAIService = { embed };
  const qdrantFake = makeQdrant(qdrant);
  const logger = fakeLogger();
  const usecase = new QueryContentUsecase(
    aiService,
    qdrantFake.service,
    logger,
  );

  return {
    usecase,
    embed: embed as unknown as vi.Mock,
    logger,
    qdrant: qdrantFake,
  };
}

function queryRequest(
  q: string,
  extra: Partial<QueryRequest> = {},
): QueryRequest {
  return {
    q,
    limit: 5,
    ...extra,
  };
}

function vector1024(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (seed + i) / 1024);
}

function makeHit(
  score: number,
  payload: Partial<VectorSearchHit["point"]["payload"]> = {},
): VectorSearchHit {
  return {
    score,
    point: {
      id: "00000000-0000-4000-8000-000000000000",
      vector: [],
      payload: {
        source: "doc.md",
        type: "markdown",
        chunkIndex: 0,
        content: "chunk content",
        headings: ["# Title"],
        indexedAt: "2026-01-01T00:00:00.000Z",
        ...payload,
      },
    },
  };
}

describe("QueryContentUsecase.execute", () => {
  beforeEach(() => {
    vi.mocked(getEnv).mockReturnValue(env);
  });

  it("returns Right with mapped hits, count and query echo", async () => {
    const vector = vector1024(0);
    const hits = [
      makeHit(0.98, {
        source: "a.md",
        chunkIndex: 1,
        content: "first chunk",
        headings: ["# A"],
      }),
      makeHit(0.71, {
        source: "b.md",
        type: "pdf",
        chunkIndex: 3,
        content: "second chunk",
        headings: ["# B"],
        indexedAt: "2026-02-02T00:00:00.000Z",
      }),
    ];
    const embed = vi.fn().mockResolvedValue(new Right([vector]));
    const { usecase, embed: embedMock, logger, qdrant } = makeUsecase(embed, {
      queryPoints: vi.fn(async () => new Right(hits)),
    });

    const result = await usecase.execute(queryRequest("what is rag?"));

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({
      query: "what is rag?",
      count: 2,
      results: [
        {
          score: 0.98,
          source: "a.md",
          type: "markdown",
          chunkIndex: 1,
          headings: ["# A"],
          content: "first chunk",
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          score: 0.71,
          source: "b.md",
          type: "pdf",
          chunkIndex: 3,
          headings: ["# B"],
          content: "second chunk",
          indexedAt: "2026-02-02T00:00:00.000Z",
        },
      ],
    });
    expect(Object.keys(result.success.results[0]).sort()).toEqual([
      "chunkIndex",
      "content",
      "headings",
      "indexedAt",
      "score",
      "source",
      "type",
    ]);

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock).toHaveBeenCalledWith(["what is rag?"]);
    expect(qdrant.service.queryPoints).toHaveBeenCalledWith(vector, 5);
    expect(logger.info).toHaveBeenCalledWith("query-content: query executed", {
      q: "what is rag?",
      limit: 5,
      count: 2,
    });
  });

  it("returns Left(HttpError 502) when embed fails", async () => {
    const embed = vi
      .fn()
      .mockResolvedValue(new Left(new AIError("boom")));
    const { usecase, logger, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(queryRequest("what is rag?"));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to embed query");
    expect(result.error.meta).toBeInstanceOf(AIError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.service.queryPoints).not.toHaveBeenCalled();
  });

  it("returns Left(HttpError 422) on embedding dimension mismatch", async () => {
    const embed = vi.fn().mockResolvedValue(new Right([[0.1, 0.2, 0.3]]));
    const { usecase, logger, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(queryRequest("what is rag?"));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(422);
    expect(result.error.message).toBe(
      "embedding dimension mismatch (expected 1024, got 3)",
    );
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.service.queryPoints).not.toHaveBeenCalled();
  });

  it("returns Left(HttpError 502) when queryPoints fails", async () => {
    const vector = vector1024(0);
    const embed = vi.fn().mockResolvedValue(new Right([vector]));
    const { usecase, logger } = makeUsecase(embed, {
      queryPoints: vi.fn(
        async () => new Left(new VectorDatabaseError("boom")),
      ),
    });

    const result = await usecase.execute(queryRequest("what is rag?"));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to query points");
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns Right with count 0 and empty results when no hits", async () => {
    const vector = vector1024(0);
    const embed = vi.fn().mockResolvedValue(new Right([vector]));
    const { usecase, logger, qdrant } = makeUsecase(embed, {
      queryPoints: vi.fn(async () => new Right([])),
    });

    const result = await usecase.execute(queryRequest("nothing here"));

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({
      query: "nothing here",
      count: 0,
      results: [],
    });
    expect(logger.info).toHaveBeenCalledWith("query-content: query executed", {
      q: "nothing here",
      limit: 5,
      count: 0,
    });
    expect(qdrant.service.queryPoints).toHaveBeenCalledWith(vector, 5);
  });
});
