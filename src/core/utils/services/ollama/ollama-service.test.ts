import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../env.js";
import { getEnv } from "../../env.js";
import type { IHttpService } from "../http-service/types.js";
import type { ILoggerService } from "../logger/types.js";
import OllamaService from "./ollama-service.js";
import { OllamaError } from "./types.js";

vi.mock("../../env.js", () => ({
  getEnv: vi.fn(),
}));

const OLLAMA_URL = "http://localhost:11434";

const env = {
  NODE_ENV: "test",
  PORT: 8080,
  OLLAMA_URL,
  OLLAMA_EMBEDDING_MODEL: "bge-m3",
  QDRANT_URL: "http://localhost:6333",
  QDRANT_COLLECTION: "vault_notes",
  QDRANT_DIMENSION: 1024,
} as Env;

function fakeHttp(post: IHttpService["post"]): IHttpService {
  return {
    get: vi.fn(),
    post,
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

function makeService(post: IHttpService["post"]) {
  const httpService = fakeHttp(post);
  const logger = fakeLogger();
  const service = new OllamaService(httpService, logger);

  return { service, httpService, logger };
}

describe("OllamaService.embed", () => {
  it("returns the vector for a single input", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const vector = [0.1, 0.2, 0.3];
    const post = vi
      .fn()
      .mockResolvedValue({ embeddings: [vector] });
    const { service, httpService } = makeService(post);

    const result = await service.embed(["hello"]);

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual([vector]);
    expect(httpService.post).toHaveBeenCalledWith(
      `${OLLAMA_URL}/api/embed`,
      { model: "bge-m3", input: ["hello"] }
    );
  });

  it("returns one vector per input for a batch", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const vectors = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const post = vi.fn().mockResolvedValue({ embeddings: vectors });
    const { service } = makeService(post);

    const result = await service.embed(["one", "two"]);

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success).toEqual(vectors);
    expect(result.success).toHaveLength(2);
  });

  it("returns Left(OllamaError) when the http call rejects", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const post = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { service, logger } = makeService(post);

    const result = await service.embed(["hello"]);

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error).toBeInstanceOf(OllamaError);
    expect(result.error.type).toBe("ollama-error");
    expect(logger.error).toHaveBeenCalled();
  });

  describe("malformed responses", () => {
    it("returns Left when embeddings is missing", async () => {
      vi.mocked(getEnv).mockReturnValue(env);
      const post = vi.fn().mockResolvedValue({});
      const { service, logger } = makeService(post);

      const result = await service.embed(["hello"]);

      expect(result.isError).toBe(true);
      if (!result.isError) throw result.success;
      expect(result.error).toBeInstanceOf(OllamaError);
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns Left when embeddings length does not match inputs", async () => {
      vi.mocked(getEnv).mockReturnValue(env);
      const post = vi
        .fn()
        .mockResolvedValue({ embeddings: [[1, 2, 3]] });
      const { service, logger } = makeService(post);

      const result = await service.embed(["one", "two"]);

      expect(result.isError).toBe(true);
      if (!result.isError) throw result.success;
      expect(result.error).toBeInstanceOf(OllamaError);
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns Left when entries are non-numeric", async () => {
      vi.mocked(getEnv).mockReturnValue(env);
      const post = vi
        .fn()
        .mockResolvedValue({
          embeddings: [
            [1, "oops", 3],
            [4, 5, 6],
          ],
        });
      const { service, logger } = makeService(post);

      const result = await service.embed(["one", "two"]);

      expect(result.isError).toBe(true);
      if (!result.isError) throw result.success;
      expect(result.error).toBeInstanceOf(OllamaError);
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns Left when entries are non-finite numbers", async () => {
      vi.mocked(getEnv).mockReturnValue(env);
      const post = vi
        .fn()
        .mockResolvedValue({ embeddings: [[NaN, Infinity, 3]] });
      const { service, logger } = makeService(post);

      const result = await service.embed(["hello"]);

      expect(result.isError).toBe(true);
      if (!result.isError) throw result.success;
      expect(result.error).toBeInstanceOf(OllamaError);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
