import { describe, expect, it } from "vitest";

import { indexRequestSchema } from "./types.js";

const base64 = (text: string): string =>
  Buffer.from(text, "utf8").toString("base64");

describe("indexRequestSchema", () => {
  it("rejects content that is not base64", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: "@@@@",
      source: "doc.md",
    });
    expect(result.success).toBe(false);
  });

  it("rejects type outside the union", () => {
    const result = indexRequestSchema.safeParse({
      type: "docx",
      content: base64("x"),
      source: "doc.md",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing content", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      source: "doc.md",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing source", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty source", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
      source: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overlapChars >= maxChunkChars (explicit)", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
      source: "doc.md",
      chunking: { maxChunkChars: 100, overlapChars: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxChunkChars", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
      source: "doc.md",
      chunking: { maxChunkChars: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer maxChunkChars", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
      source: "doc.md",
      chunking: { maxChunkChars: 10.5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects overlapChars alone above default max", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
      source: "doc.md",
      chunking: { overlapChars: 2000 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts minimal markdown request", () => {
    const result = indexRequestSchema.safeParse({
      type: "markdown",
      content: base64("x"),
      source: "doc.md",
    });
    expect(result.success).toBe(true);
  });

  it("accepts pdf type with source and valid chunking", () => {
    const result = indexRequestSchema.safeParse({
      type: "pdf",
      content: base64("x"),
      source: "https://example.com/doc.pdf",
      chunking: { maxChunkChars: 1000, overlapChars: 100 },
    });
    expect(result.success).toBe(true);
  });
});
