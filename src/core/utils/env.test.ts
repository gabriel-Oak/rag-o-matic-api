import { afterEach, describe, expect, it, vi } from "vitest";
import { envSchema, getEnv, loadEnv } from "./env.js";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  PORT: "8080",
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_EMBEDDING_MODEL: "bge-m3",
  QDRANT_URL: "http://localhost:6333",
  QDRANT_API_KEY: "secret",
  QDRANT_COLLECTION: "vault_notes",
  QDRANT_DIMENSION: "1024",
};

describe("envSchema / loadEnv", () => {
  it("parses a full valid env into a frozen typed object", () => {
    const env = loadEnv(validEnv);
    expect(env).toEqual({
      NODE_ENV: "development",
      PORT: 8080,
      OLLAMA_URL: "http://localhost:11434",
      OLLAMA_EMBEDDING_MODEL: "bge-m3",
      QDRANT_URL: "http://localhost:6333",
      QDRANT_API_KEY: "secret",
      QDRANT_COLLECTION: "vault_notes",
      QDRANT_DIMENSION: 1024,
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("applies defaults for omitted optional fields", () => {
    const env = loadEnv({
      OLLAMA_URL: "http://localhost:11434",
      QDRANT_URL: "http://localhost:6333",
    });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(8080);
    expect(env.OLLAMA_EMBEDDING_MODEL).toBe("bge-m3");
    expect(env.QDRANT_COLLECTION).toBe("vault_notes");
    expect(env.QDRANT_DIMENSION).toBe(1024);
    expect(env.QDRANT_API_KEY).toBeUndefined();
  });

  it("coerces PORT and QDRANT_DIMENSION to numbers", () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(8080);
    expect(env.QDRANT_DIMENSION).toBe(1024);
  });

  it("treats empty QDRANT_API_KEY as undefined", () => {
    const env = loadEnv({ ...validEnv, QDRANT_API_KEY: "" });
    expect(env.QDRANT_API_KEY).toBeUndefined();
  });

  it("names the missing OLLAMA_URL when absent", () => {
    const rest: NodeJS.ProcessEnv = { ...validEnv };
    delete rest.OLLAMA_URL;
    expect(() => loadEnv(rest)).toThrow(/OLLAMA_URL/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadEnv({ ...validEnv, PORT: "abc" })).toThrow(/PORT/);
  });

  it("rejects a non-positive QDRANT_DIMENSION", () => {
    expect(() =>
      loadEnv({ ...validEnv, QDRANT_DIMENSION: "0" })
    ).toThrow(/QDRANT_DIMENSION/);
  });

  it("lists every invalid field in a single error", () => {
    const bad: NodeJS.ProcessEnv = {
      ...validEnv,
      PORT: "abc",
      OLLAMA_URL: "not a url",
    };
    delete bad.QDRANT_URL;
    expect(() => loadEnv(bad)).toThrow(/PORT/);
    expect(() => loadEnv(bad)).toThrow(/OLLAMA_URL/);
    expect(() => loadEnv(bad)).toThrow(/QDRANT_URL/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow(
      /NODE_ENV/
    );
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads process.env and memoizes the frozen object", () => {
    vi.stubEnv("OLLAMA_URL", "http://localhost:11434");
    vi.stubEnv("QDRANT_URL", "http://localhost:6333");
    vi.stubEnv("PORT", "9090");

    const first = getEnv();
    const second = getEnv();

    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.PORT).toBe(9090);
    expect(first.OLLAMA_EMBEDDING_MODEL).toBe("bge-m3");
  });
});

describe("envSchema export", () => {
  it("exposes the zod schema for reuse", () => {
    expect(envSchema.shape.OLLAMA_URL).toBeDefined();
  });
});
