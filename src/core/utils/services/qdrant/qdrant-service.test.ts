import { QdrantClient } from "@qdrant/js-client-rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../env.js";
import { getEnv } from "../../env.js";
import type { ILoggerService } from "../logger/types.js";
import QdrantService from "./qdrant-service.js";
import { QdrantError } from "./types.js";

vi.mock("../../env.js", () => ({
  getEnv: vi.fn(),
}));

vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: vi.fn(),
}));

const QDRANT_URL = "http://localhost:6333";

const env = {
  NODE_ENV: "test",
  PORT: 8080,
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_EMBEDDING_MODEL: "bge-m3",
  QDRANT_URL,
  QDRANT_COLLECTION: "vault_notes",
  QDRANT_DIMENSION: 1024,
} as Env;

interface FakeQdrantClient {
  getCollection: ReturnType<typeof vi.fn>;
  createCollection: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  close?: ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

function makeFakeClient(
  overrides: Partial<FakeQdrantClient> = {}
): FakeQdrantClient {
  return {
    getCollection: vi.fn().mockResolvedValue({ status: "green" }),
    createCollection: vi.fn().mockResolvedValue(true),
    upsert: vi.fn().mockResolvedValue({ result: {} }),
    query: vi.fn().mockResolvedValue({ points: [] }),
    delete: vi.fn().mockResolvedValue({ result: {} }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeLogger(): ILoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeService(client: FakeQdrantClient) {
  const logger = fakeLogger();
  const service = new QdrantService(
    logger,
    client as unknown as QdrantClient
  );

  return { service, client, logger };
}

describe("QdrantService constructor", () => {
  it("builds the client from the env url when no client is passed", () => {
    vi.mocked(getEnv).mockReturnValue(env);

    new QdrantService(fakeLogger());

    expect(QdrantClient).toHaveBeenCalledWith({ url: QDRANT_URL });
  });

  it("includes the apiKey only when it is set", () => {
    vi.mocked(getEnv).mockReturnValue({
      ...env,
      QDRANT_API_KEY: "secret-key",
    });
    new QdrantService(fakeLogger());
    expect(QdrantClient).toHaveBeenCalledWith({
      url: QDRANT_URL,
      apiKey: "secret-key",
    });

    vi.mocked(QdrantClient).mockClear();
    vi.mocked(getEnv).mockReturnValue(env);
    new QdrantService(fakeLogger());
    expect(QdrantClient).toHaveBeenCalledWith({ url: QDRANT_URL });
  });

  it("uses the injected client when provided", () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const client = makeFakeClient();
    const service = new QdrantService(
      fakeLogger(),
      client as unknown as QdrantClient
    );

    expect(QdrantClient).not.toHaveBeenCalled();
    expect(service).toBeInstanceOf(QdrantService);
  });
});

describe("QdrantService.ensureCollection", () => {
  it("returns Right when the collection already exists", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client } = makeService(makeFakeClient());

    const result = await service.ensureCollection();

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toBeUndefined();
    expect(client.getCollection).toHaveBeenCalledWith("vault_notes");
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it("creates the collection with env values when it does not exist", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client } = makeService(
      makeFakeClient({
        getCollection: vi
          .fn()
          .mockRejectedValue(new Error("Not found: collection vault_notes")),
      })
    );

    const result = await service.ensureCollection();

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toBeUndefined();
    expect(client.createCollection).toHaveBeenCalledWith("vault_notes", {
      vectors: { size: 1024, distance: "Cosine" },
    });
  });

  it("returns Left(QdrantError) and logs when getCollection fails with another error", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client, logger } = makeService(
      makeFakeClient({
        getCollection: vi
          .fn()
          .mockRejectedValue(new Error("connect ECONNREFUSED")),
      })
    );

    const result = await service.ensureCollection();

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error).toBeInstanceOf(QdrantError);
    expect(result.error.type).toBe("qdrant-error");
    expect(client.createCollection).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns Left(QdrantError) and logs when createCollection fails", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client, logger } = makeService(
      makeFakeClient({
        getCollection: vi
          .fn()
          .mockRejectedValue(new Error("Not found")),
        createCollection: vi
          .fn()
          .mockRejectedValue(new Error("boom")),
      })
    );

    const result = await service.ensureCollection();

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error).toBeInstanceOf(QdrantError);
    expect(client.createCollection).toHaveBeenCalledWith("vault_notes", {
      vectors: { size: 1024, distance: "Cosine" },
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("QdrantService.upsertPoints", () => {
  it("delegates the mapped points to the client and returns Right", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client } = makeService(makeFakeClient());
    const points = [
      { id: "a", vector: [1, 2], payload: { text: "one" } },
      { id: "b", vector: [3, 4], payload: {} },
    ];

    const result = await service.upsertPoints(points);

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toBeUndefined();
    expect(client.upsert).toHaveBeenCalledWith("vault_notes", {
      points: [
        { id: "a", vector: [1, 2], payload: { text: "one" } },
        { id: "b", vector: [3, 4], payload: {} },
      ],
    });
  });

  it("returns Left(QdrantError) and logs when the client rejects", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client, logger } = makeService(
      makeFakeClient({
        upsert: vi.fn().mockRejectedValue(new Error("boom")),
      })
    );

    const result = await service.upsertPoints([
      { id: "a", vector: [1], payload: {} },
    ]);

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error).toBeInstanceOf(QdrantError);
    expect(result.error.type).toBe("qdrant-error");
    expect(client.upsert).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("QdrantService.queryPoints", () => {
  it("maps the response entries to search hits and returns Right", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const vector = [0.1, 0.2];
    const { service, client } = makeService(
      makeFakeClient({
        query: vi.fn().mockResolvedValue({
          points: [
            {
              id: "p1",
              score: 0.9,
              payload: { text: "hello" },
              vector: [0.1, 0.2],
            },
            { id: 42, score: 0.5, payload: null },
          ],
        }),
      })
    );

    const result = await service.queryPoints(vector, 5);

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual([
      {
        score: 0.9,
        point: { id: "p1", vector: [0.1, 0.2], payload: { text: "hello" } },
      },
      { score: 0.5, point: { id: "42", vector: [], payload: {} } },
    ]);
    expect(client.query).toHaveBeenCalledWith("vault_notes", {
      query: vector,
      limit: 5,
      with_payload: true,
    });
  });

  it("returns Left(QdrantError) and logs when the client rejects", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, logger } = makeService(
      makeFakeClient({
        query: vi.fn().mockRejectedValue(new Error("boom")),
      })
    );

    const result = await service.queryPoints([0.1], 3);

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error).toBeInstanceOf(QdrantError);
    expect(result.error.type).toBe("qdrant-error");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("QdrantService.deletePointsByFilter", () => {
  it("delegates the filter to the client and returns Right", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client } = makeService(makeFakeClient());
    const filter = { must: [{ key: "status", match: { value: "active" } }] };

    const result = await service.deletePointsByFilter(filter);

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toBeUndefined();
    expect(client.delete).toHaveBeenCalledWith("vault_notes", { filter });
  });

  it("returns Left(QdrantError) and logs when the client rejects", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const { service, client, logger } = makeService(
      makeFakeClient({
        delete: vi.fn().mockRejectedValue(new Error("boom")),
      })
    );

    const result = await service.deletePointsByFilter({ must: [] });

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error).toBeInstanceOf(QdrantError);
    expect(result.error.type).toBe("qdrant-error");
    expect(client.delete).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("QdrantService.close", () => {
  it("delegates to client.close when available", async () => {
    const { service, client } = makeService(makeFakeClient());

    await service.close();

    expect(client.close).toHaveBeenCalled();
  });

  it("is a no-op when the client has no close", async () => {
    const client = makeFakeClient();
    delete client.close;
    const { service } = makeService(client);

    await expect(service.close()).resolves.toBeUndefined();
  });
});
