import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../utils/env.js";
import { getEnv } from "../../../utils/env.js";
import { AIError, type IAIService } from "../../../utils/services/ai/types.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type {
  IVectorDatabaseService,
  VectorPoint,
} from "../../../utils/services/vector-database/types.js";
import { VectorDatabaseError } from "../../../utils/services/vector-database/types.js";
import { Left, Right } from "../../../utils/types.js";
import { pointId } from "../utils/build-vector-points.js";
import type { IndexRequest } from "../models/types.js";
import IndexContentUsecase from "./index-content-usecase.js";

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

type QdrantOverrides = Partial<
  Pick<
    IVectorDatabaseService,
    "ensureCollection" | "deletePointsByFilter" | "upsertPoints"
  >
>;

function makeQdrant(overrides: QdrantOverrides = {}) {
  const upsertedBatches: VectorPoint[][] = [];
  const deleteFilters: Record<string, unknown>[] = [];

  const service: IVectorDatabaseService = {
    ensureCollection: vi.fn(async () => new Right(undefined)),
    upsertPoints: vi.fn(async (points: VectorPoint[]) => {
      upsertedBatches.push(points);
      return new Right(undefined);
    }),
    queryPoints: vi.fn(async () => new Right([])),
    deletePointsByFilter: vi.fn(async (filter: Record<string, unknown>) => {
      deleteFilters.push(filter);
      return new Right(undefined);
    }),
    close: vi.fn(async () => undefined),
    ...overrides,
  };

  return { service, upsertedBatches, deleteFilters };
}

function makeUsecase(embed: IAIService["embed"], qdrant: QdrantOverrides = {}) {
  const aiService: IAIService = { embed };
  const qdrantFake = makeQdrant(qdrant);
  const logger = fakeLogger();
  const usecase = new IndexContentUsecase(
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

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function markdownRequest(
  content: string,
  extra: Partial<IndexRequest> = {},
): IndexRequest {
  return {
    type: "markdown",
    content: b64(content),
    source: "test.md",
    ...extra,
  };
}

function vector1024(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (seed + i) / 1024);
}

describe("IndexContentUsecase.execute", () => {
  beforeEach(() => {
    vi.mocked(getEnv).mockReturnValue(env);
  });

  it("indexes markdown with frontmatter: summary shape, points, delete filter", async () => {
    const frontmatter = "tags: [rag]";
    const markdown = `---\n${frontmatter}\n---\n\n# Alpha\n\nFirst section text.\n\n# Beta\n\nSecond section text.`;
    const v0 = vector1024(0);
    const v1 = vector1024(1);
    const embed = vi.fn().mockResolvedValue(new Right([v0, v1]));
    const { usecase, embed: embedMock, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(
      markdownRequest(markdown, { source: "doc.md" }),
    );

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({
      source: "doc.md",
      type: "markdown",
      model: "bge-m3",
      chunkCount: 2,
      upserted: 2,
    });

    expect(embedMock).toHaveBeenCalledTimes(1);
    const [inputs] = embedMock.mock.calls[0];
    expect(inputs).toEqual([
      frontmatter + "\n\n# Alpha\n\nFirst section text.",
      frontmatter + "\n\n# Beta\n\nSecond section text.",
    ]);

    expect(qdrant.deleteFilters).toEqual([
      { must: [{ key: "source", match: { value: "doc.md" } }] },
    ]);

    expect(qdrant.upsertedBatches).toHaveLength(1);
    const [points] = qdrant.upsertedBatches;
    expect(points).toHaveLength(2);

    expect(points[0].id).toBe(pointId("doc.md", 0));
    expect(points[1].id).toBe(pointId("doc.md", 1));
    expect(points[0].vector).toEqual(v0);
    expect(points[1].vector).toEqual(v1);

    expect(points[0].payload).toMatchObject({
      source: "doc.md",
      type: "markdown",
      chunkIndex: 0,
      content: "# Alpha\n\nFirst section text.",
      headings: ["# Alpha"],
      frontmatter,
    });
    expect(points[1].payload).toMatchObject({
      chunkIndex: 1,
      content: "# Beta\n\nSecond section text.",
      headings: ["# Beta"],
    });
    expect(Object.keys(points[0].payload).sort()).toEqual([
      "chunkIndex",
      "content",
      "frontmatter",
      "headings",
      "indexedAt",
      "source",
      "type",
    ]);

    const indexedAt = points[0].payload.indexedAt;
    expect(typeof indexedAt).toBe("string");
    expect(new Date(indexedAt).toISOString()).toBe(indexedAt);
    expect(points[1].payload.indexedAt).toBe(indexedAt);
  });

  it("omits frontmatter payload key when markdown has no frontmatter", async () => {
    const markdown = "# Title\n\nText here.";
    const v0 = vector1024(0);
    const embed = vi.fn().mockResolvedValue(new Right([v0]));
    const { usecase, embed: embedMock, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual({
      source: "test.md",
      type: "markdown",
      model: "bge-m3",
      chunkCount: 1,
      upserted: 1,
    });

    expect(embedMock).toHaveBeenCalledTimes(1);
    const [inputs] = embedMock.mock.calls[0];
    expect(inputs).toEqual(["# Title\n\nText here."]);

    expect(qdrant.deleteFilters).toEqual([
      { must: [{ key: "source", match: { value: "test.md" } }] },
    ]);

    const [points] = qdrant.upsertedBatches;
    expect(points).toHaveLength(1);
    expect(points[0].id).toBe(pointId("test.md", 0));
    expect(points[0].vector).toEqual(v0);
    expect(points[0].payload).not.toHaveProperty("frontmatter");
    expect(Object.keys(points[0].payload).sort()).toEqual([
      "chunkIndex",
      "content",
      "headings",
      "indexedAt",
      "source",
      "type",
    ]);
  });

  it("returns Left(HttpError 422) on embedding dimension mismatch", async () => {
    const markdown = "# Title\n\nText here.";
    const embed = vi.fn().mockResolvedValue(new Right([[0.1, 0.2, 0.3]]));
    const { usecase, logger, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(422);
    expect(result.error.message).toBe(
      "embedding dimension mismatch (expected 1024, got 3)",
    );
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.service.ensureCollection).not.toHaveBeenCalled();
    expect(qdrant.deleteFilters).toHaveLength(0);
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 502) when ensureCollection fails", async () => {
    const markdown = "# Title\n\nText here.";
    const embed = vi.fn().mockResolvedValue(new Right([vector1024(0)]));
    const { usecase, logger, qdrant } = makeUsecase(embed, {
      ensureCollection: vi.fn(async () => new Left(new VectorDatabaseError("boom"))),
    });

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to ensure Qdrant collection");
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 502) when deletePointsByFilter fails", async () => {
    const markdown = "# Title\n\nText here.";
    const embed = vi.fn().mockResolvedValue(new Right([vector1024(0)]));
    const { usecase, logger, qdrant } = makeUsecase(embed, {
      deletePointsByFilter: vi.fn(
        async () => new Left(new VectorDatabaseError("boom")),
      ),
    });

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe(
      "failed to delete existing points for source",
    );
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 502) when upsertPoints fails", async () => {
    const markdown = "# Title\n\nText here.";
    const embed = vi.fn().mockResolvedValue(new Right([vector1024(0)]));
    const { usecase, logger, qdrant } = makeUsecase(embed, {
      upsertPoints: vi.fn(async () => new Left(new VectorDatabaseError("boom"))),
    });

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("failed to upsert points");
    expect(result.error.meta).toBeInstanceOf(VectorDatabaseError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 422) when extractText fails", async () => {
    const embed = vi.fn();
    const { usecase, embed: embedMock, logger, qdrant } = makeUsecase(embed);

    const result = await usecase.execute({
      type: "pdf",
      content: Buffer.from("not a pdf").toString("base64"),
      source: "doc.pdf",
    });

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(422);
    expect(logger.error).toHaveBeenCalled();
    expect(embedMock).not.toHaveBeenCalled();
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 502) when AI fails", async () => {
    const markdown = "# Title\n\nText here.";
    const embed = vi
      .fn()
      .mockResolvedValue(new Left(new AIError("boom")));
    const { usecase, logger, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.meta).toBeInstanceOf(AIError);
    expect(logger.error).toHaveBeenCalled();
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 400) when no chunks are produced", async () => {
    const embed = vi.fn();
    const { usecase, embed: embedMock, qdrant } = makeUsecase(embed);

    const result = await usecase.execute(
      markdownRequest("---\ntags: [x]\n---\n"),
    );

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(400);
    expect(result.error.message).toBe(
      "no chunks produced from the provided content",
    );
    expect(embedMock).not.toHaveBeenCalled();
    expect(qdrant.upsertedBatches).toHaveLength(0);
  });

  it("returns Left(HttpError 422) for whitespace-only markdown (extractText guards first)", async () => {
    const embed = vi.fn();
    const { usecase } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest("   \n  \n"));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(422);
  });
});
