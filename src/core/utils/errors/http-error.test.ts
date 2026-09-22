import { afterEach, describe, expect, it, vi } from "vitest";
import BaseError from "./base-error.js";
import HttpError from "./http-error.js";

class TestBaseError extends BaseError {
  public readonly type = "test-error";
}

describe("HttpError", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to statusCode 500 and default message when no props", () => {
    const error = new HttpError();
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Tivemos algum problema desconhecido");
    expect(error.type).toBe("http-error");
    expect(error).toBeInstanceOf(Error);
  });

  it("accepts custom message and statusCode", () => {
    const error = new HttpError({ message: "Not found", statusCode: 404 });
    expect(error.message).toBe("Not found");
    expect(error.statusCode).toBe(404);
  });

  it("keeps meta when NODE_ENV is not production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = new HttpError({ message: "boom", meta: { code: "X" } });
    expect(error.meta).toEqual({ code: "X" });
  });

  it("keeps meta when NODE_ENV is test", () => {
    vi.stubEnv("NODE_ENV", "test");
    const error = new HttpError({ message: "boom", meta: { code: "X" } });
    expect(error.meta).toEqual({ code: "X" });
  });

  it("strips meta when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = new HttpError({ message: "boom", meta: { code: "X" } });
    expect(error.meta).toBeUndefined();
  });

  it("toString() without meta is 'statusCode: message'", () => {
    const error = new HttpError({ message: "Not found", statusCode: 404 });
    expect(error.toString()).toBe("404: Not found");
  });

  it("toString() with meta appends JSON", () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = new HttpError({
      message: "Not found",
      statusCode: 404,
      meta: { a: 1 },
    });
    expect(error.toString()).toBe(`404: Not found | \n${JSON.stringify({ a: 1 })}`);
  });
});

describe("BaseError", () => {
  it("passes message and meta through", () => {
    const error = new TestBaseError("something broke", { detail: 1 });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("something broke");
    expect(error.meta).toEqual({ detail: 1 });
    expect(error.type).toBe("test-error");
  });

  it("works without meta", () => {
    const error = new TestBaseError("plain");
    expect(error.message).toBe("plain");
    expect(error.meta).toBeUndefined();
  });
});
