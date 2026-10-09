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
import { buildSparseVector } from "../utils/sparse-tf.js";
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
    countPointsByFilter: vi.fn(async () => new Right(0)),
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

  it("indexes markdown with frontmatter: metadata chunk 0, points, delete filter", async () => {
    const frontmatter = "tags: [rag]";
    const markdown = `---\n${frontmatter}\n---\n\n# Alpha\n\nFirst section text.\n\n# Beta\n\nSecond section text.`;
    const metadataContent = "doc.md\n\n## Metadados\n\n" + frontmatter;
    const chunk1Content = "doc.md\n\n# Alpha\n\nFirst section text.";
    const chunk2Content = "doc.md\n\n# Beta\n\nSecond section text.";
    const v0 = vector1024(0);
    const v1 = vector1024(1);
    const v2 = vector1024(2);
    const embed = vi.fn().mockResolvedValue(new Right([v0, v1, v2]));
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
      chunkCount: 3,
      upserted: 3,
    });

    expect(embedMock).toHaveBeenCalledTimes(1);
    const [inputs] = embedMock.mock.calls[0];
    expect(inputs).toEqual([
      metadataContent,
      chunk1Content,
      chunk2Content,
    ]);

    expect(qdrant.deleteFilters).toEqual([
      { must: [{ key: "source", match: { value: "doc.md" } }] },
    ]);

    expect(qdrant.upsertedBatches).toHaveLength(1);
    const [points] = qdrant.upsertedBatches;
    expect(points).toHaveLength(3);

    expect(points[0].id).toBe(pointId("doc.md", 0));
    expect(points[1].id).toBe(pointId("doc.md", 1));
    expect(points[2].id).toBe(pointId("doc.md", 2));
    expect(points[0].vector).toEqual(v0);
    expect(points[1].vector).toEqual(v1);
    expect(points[2].vector).toEqual(v2);

    // Chunk 0 is the metadata chunk: type overridden, no body text.
    expect(points[0].payload).toMatchObject({
      source: "doc.md",
      type: "metadata",
      chunkIndex: 0,
      content: metadataContent,
      headings: ["## Metadados"],
      frontmatter,
    });
    // Chunks 1+ keep the doc type, no frontmatter in their content.
    expect(points[1].payload).toMatchObject({
      source: "doc.md",
      type: "markdown",
      chunkIndex: 1,
      content: chunk1Content,
      headings: ["# Alpha"],
      frontmatter,
    });
    expect(points[2].payload).toMatchObject({
      type: "markdown",
      chunkIndex: 2,
      content: chunk2Content,
      headings: ["# Beta"],
      frontmatter,
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

    // One sparse vector per final chunk, aligned by index.
    expect(points[0].sparse).toEqual(buildSparseVector(metadataContent));
    expect(points[1].sparse).toEqual(buildSparseVector(chunk1Content));
    expect(points[2].sparse).toEqual(buildSparseVector(chunk2Content));

    const indexedAt = points[0].payload.indexedAt;
    expect(typeof indexedAt).toBe("string");
    expect(new Date(indexedAt).toISOString()).toBe(indexedAt);
    expect(points[1].payload.indexedAt).toBe(indexedAt);
    expect(points[2].payload.indexedAt).toBe(indexedAt);
  });

  it("logs metadataChunks count on success", async () => {
    const markdown = "---\ntags: [rag]\n---\n\n# Alpha\n\nText.";
    const v0 = vector1024(0);
    const v1 = vector1024(1);
    const embed = vi.fn().mockResolvedValue(new Right([v0, v1]));
    const { usecase, logger } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      "index-content: content indexed",
      expect.objectContaining({
        source: "test.md",
        chunkCount: 2,
        metadataChunks: 1,
      }),
    );
  });

  it("omits frontmatter payload key when markdown has no frontmatter", async () => {
    const markdown = "# Title\n\nText here.";
    const content = "test.md\n\n# Title\n\nText here.";
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
    expect(inputs).toEqual([content]);

    expect(qdrant.deleteFilters).toEqual([
      { must: [{ key: "source", match: { value: "test.md" } }] },
    ]);

    const [points] = qdrant.upsertedBatches;
    expect(points).toHaveLength(1);
    expect(points[0].id).toBe(pointId("test.md", 0));
    expect(points[0].vector).toEqual(v0);
    expect(points[0].sparse).toEqual(buildSparseVector(content));
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

  it("indexes frontmatter with empty body as a single metadata chunk (no 400)", async () => {
    const frontmatter = "tags: [x]";
    const markdown = `---\n${frontmatter}\n---\n`;
    const content = "test.md\n\n## Metadados\n\n" + frontmatter;
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
    expect(embedMock.mock.calls[0][0]).toEqual([content]);

    const [points] = qdrant.upsertedBatches;
    expect(points).toHaveLength(1);
    expect(points[0].payload).toMatchObject({
      source: "test.md",
      type: "metadata",
      chunkIndex: 0,
      content,
      headings: ["## Metadados"],
      frontmatter,
    });
    expect(points[0].sparse).toEqual(buildSparseVector(content));
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

    // Heading-only body: no section text, no frontmatter → zero chunks.
    const result = await usecase.execute(markdownRequest("# Title\n"));

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
