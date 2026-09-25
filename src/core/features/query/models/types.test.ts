import { describe, expect, it } from "vitest";

import { queryRequestSchema } from "./types.js";

describe("queryRequestSchema", () => {
  it("applies default limit of 5 when omitted", () => {
    const result = queryRequestSchema.safeParse({ q: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
    }
  });

  it("coerces numeric string limit", () => {
    const result = queryRequestSchema.safeParse({ q: "x", limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it("trims q before validating", () => {
    const result = queryRequestSchema.safeParse({ q: "  x  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("x");
    }
  });

  it("rejects missing q", () => {
    const result = queryRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty q", () => {
    const result = queryRequestSchema.safeParse({ q: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only q", () => {
    const result = queryRequestSchema.safeParse({ q: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects limit below 1", () => {
    const result = queryRequestSchema.safeParse({ q: "x", limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above 20", () => {
    const result = queryRequestSchema.safeParse({ q: "x", limit: "21" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric limit", () => {
    const result = queryRequestSchema.safeParse({ q: "x", limit: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    const result = queryRequestSchema.safeParse({ q: "x", limit: "2.5" });
    expect(result.success).toBe(false);
  });
});
