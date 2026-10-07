import { describe, expect, it } from "vitest";
import serializeError from "./serialize-error.js";

describe("serializeError", () => {
  it("converts a plain Error into { name, message }", () => {
    expect(serializeError(new Error("boom"))).toEqual({
      name: "Error",
      message: "boom",
    });
  });

  it("keeps the error name for built-in subclasses", () => {
    expect(serializeError(new TypeError("fetch failed"))).toEqual({
      name: "TypeError",
      message: "fetch failed",
    });
  });

  it("extracts the non-enumerable cause chain", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:6333"), {
      code: "ECONNREFUSED",
    });
    const error = new TypeError("fetch failed", { cause });

    expect(serializeError(error)).toEqual({
      name: "TypeError",
      message: "fetch failed",
      cause: {
        name: "Error",
        message: "connect ECONNREFUSED 1.2.3.4:6333",
        code: "ECONNREFUSED",
      },
    });
  });

  it("does not emit cause for non-Error causes", () => {
    const error = new Error("boom", { cause: "a string" });

    expect(serializeError(error)).toEqual({
      name: "Error",
      message: "boom",
    });
  });

  it("preserves own enumerable props (BaseError style) and recurses into meta", () => {
    class BaseError extends Error {
      readonly type = "app-error";
      constructor(
        public readonly message: string,
        public readonly meta?: unknown
      ) {
        super();
      }
    }

    const error = new BaseError("app err", {
      inner: new Error("raw"),
    });

    expect(serializeError(error)).toEqual({
      message: "app err",
      meta: {
        inner: { name: "Error", message: "raw" },
      },
      type: "app-error",
      name: "Error",
    });
  });

  it("recurses into plain objects and arrays", () => {
    expect(
      serializeError({
        collection: "vault",
        items: [new Error("one"), { deep: new RangeError("two") }],
      })
    ).toEqual({
      collection: "vault",
      items: [
        { name: "Error", message: "one" },
        { deep: { name: "RangeError", message: "two" } },
      ],
    });
  });

  it("marks circular references instead of recursing forever", () => {
    const value: Record<string, unknown> = { self: null };
    value.self = value;

    expect(serializeError(value)).toEqual({ self: "[Circular]" });
  });

  it("drops function values from plain objects", () => {
    expect(serializeError({ fn: () => 1, keep: 2 })).toEqual({ keep: 2 });
  });

  it("passes primitives through untouched", () => {
    expect(serializeError("text")).toBe("text");
    expect(serializeError(42)).toBe(42);
    expect(serializeError(null)).toBe(null);
    expect(serializeError(undefined)).toBe(undefined);
  });
});
