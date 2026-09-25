import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildPoints, pointId } from "./build-vector-points.js";

const INDEXED_AT = "2026-09-22T12:00:00.000Z";

describe("pointId", () => {
  it("returns the first 16 bytes of sha256 of `${source}#${chunkIndex}` as a UUID", () => {
    const hash = createHash("sha256").update("nota.md#0").digest("hex");
    const expected = [
      hash.slice(0, 8),
      hash.slice(8, 12),
      hash.slice(12, 16),
      hash.slice(16, 20),
      hash.slice(20, 32),
    ].join("-");
    expect(pointId("nota.md", 0)).toBe(expected);
  });

  it("is deterministic: same input yields the same ID", () => {
    expect(pointId("nota.md", 3)).toBe(pointId("nota.md", 3));
  });

  it("differs when source differs", () => {
    expect(pointId("nota.md", 0)).not.toBe(pointId("outra.md", 0));
  });

  it("differs when chunkIndex differs", () => {
    expect(pointId("nota.md", 0)).not.toBe(pointId("nota.md", 1));
  });

  it("matches the UUID format 8-4-4-4-12 (lowercase hex)", () => {
    expect(pointId("nota.md", 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("buildPoints", () => {
  it("builds one point per chunk with id, vector and payload shape", () => {
    const points = buildPoints({
      source: "nota.md",
      type: "markdown",
      chunks: [
        { content: "## Setup\n\n...", headings: ["# Nota", "## Setup"] },
        { content: "## Uso\n\n...", headings: ["# Nota", "## Uso"] },
      ],
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      frontmatter: "tags: [rag]",
      indexedAt: INDEXED_AT,
    });

    expect(points).toHaveLength(2);
    expect(points[0].id).toBe(pointId("nota.md", 0));
    expect(points[1].id).toBe(pointId("nota.md", 1));
    expect(points[0].vector).toEqual([0.1, 0.2]);
    expect(points[1].vector).toEqual([0.3, 0.4]);
    expect(points[0].payload).toEqual({
      source: "nota.md",
      type: "markdown",
      chunkIndex: 0,
      content: "## Setup\n\n...",
      headings: ["# Nota", "## Setup"],
      frontmatter: "tags: [rag]",
      indexedAt: INDEXED_AT,
    });
    expect(points[1].payload).toEqual({
      source: "nota.md",
      type: "markdown",
      chunkIndex: 1,
      content: "## Uso\n\n...",
      headings: ["# Nota", "## Uso"],
      frontmatter: "tags: [rag]",
      indexedAt: INDEXED_AT,
    });
  });

  it("includes the frontmatter key only when frontmatter is provided", () => {
    const withFm = buildPoints({
      source: "nota.md",
      type: "markdown",
      chunks: [{ content: "a", headings: [] }],
      embeddings: [[1]],
      frontmatter: "tags: [rag]",
      indexedAt: INDEXED_AT,
    });
    const withoutFm = buildPoints({
      source: "nota.md",
      type: "markdown",
      chunks: [{ content: "a", headings: [] }],
      embeddings: [[1]],
      indexedAt: INDEXED_AT,
    });

    expect(withFm[0].payload).toHaveProperty("frontmatter", "tags: [rag]");
    expect(withoutFm[0].payload).not.toHaveProperty("frontmatter");
  });

  it("propagates indexedAt to every point", () => {
    const points = buildPoints({
      source: "nota.md",
      type: "markdown",
      chunks: [
        { content: "a", headings: [] },
        { content: "b", headings: [] },
      ],
      embeddings: [
        [1],
        [2],
      ],
      indexedAt: INDEXED_AT,
    });

    expect(points[0].payload.indexedAt).toBe(INDEXED_AT);
    expect(points[1].payload.indexedAt).toBe(INDEXED_AT);
  });

  it("builds points for pdf type", () => {
    const points = buildPoints({
      source: "doc.pdf",
      type: "pdf",
      chunks: [{ content: "page one", headings: [] }],
      embeddings: [[0.5]],
      indexedAt: INDEXED_AT,
    });

    expect(points[0].payload.type).toBe("pdf");
    expect(points[0].payload.source).toBe("doc.pdf");
    expect(points[0].payload.headings).toEqual([]);
  });

  it("returns an empty array for zero chunks", () => {
    const points = buildPoints({
      source: "nota.md",
      type: "markdown",
      chunks: [],
      embeddings: [],
      indexedAt: INDEXED_AT,
    });

    expect(points).toEqual([]);
  });
});
