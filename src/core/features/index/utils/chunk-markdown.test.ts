import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_OVERLAP_CHARS,
  chunkMarkdown,
} from "./chunk-markdown.js";

describe("chunkMarkdown", () => {
  it("exports the default sizing constants", () => {
    expect(DEFAULT_MAX_CHUNK_CHARS).toBe(1500);
    expect(DEFAULT_OVERLAP_CHARS).toBe(200);
  });

  it("returns a single chunk with empty headings for a doc without headings", () => {
    const chunks = chunkMarkdown("Hello world.");
    expect(chunks).toEqual([{ content: "Hello world.", headings: [] }]);
  });

  it("includes the heading line in the chunk content and headings for a single heading", () => {
    const chunks = chunkMarkdown("# Title\n\nSome body text.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headings).toEqual(["# Title"]);
    expect(chunks[0].content).toContain("# Title");
    expect(chunks[0].content).toContain("Some body text.");
  });

  it("keeps the heading trail for nested headings (## under #)", () => {
    const chunks = chunkMarkdown("# A\n\n## B\n\nNested text.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headings).toEqual(["# A", "## B"]);
    expect(chunks[0].content).toContain("# A");
    expect(chunks[0].content).toContain("## B");
    expect(chunks[0].content).toContain("Nested text.");
  });

  it("resets the heading trail when a heading of the same or higher level appears", () => {
    const chunks = chunkMarkdown(
      "# A\n\ntext a\n\n## B\n\ntext b\n\n### C\n\ntext c\n\n## D\n\ntext d",
    );
    expect(chunks.map((chunk) => chunk.headings)).toEqual([
      ["# A"],
      ["# A", "## B"],
      ["# A", "## B", "### C"],
      ["# A", "## D"],
    ]);
  });

  it("splits a long section into multiple chunks, each <= max, with the 2nd chunk starting with the last overlapChars of the 1st", () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `${i}abcdefghi`);
    const body = paragraphs.join("\n\n");
    const max = 20;
    const overlap = 8;
    const chunks = chunkMarkdown(body, {
      maxChunkChars: max,
      overlapChars: overlap,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(max);
      expect(chunk.headings).toEqual([]);
    }
    for (let i = 1; i < chunks.length; i++) {
      expect(
        chunks[i].content.startsWith(
          chunks[i - 1].content.slice(-overlap),
        ),
      ).toBe(true);
    }
  });

  it("splits a single paragraph bigger than max into hard windows overlapping by max - step", () => {
    const body = "abcde".repeat(12); // 60 chars
    const max = 20;
    const overlap = 8;
    const step = max - overlap;
    const chunks = chunkMarkdown(body, {
      maxChunkChars: max,
      overlapChars: overlap,
    });

    expect(chunks.length).toBe(5);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(max);
      expect(chunk.headings).toEqual([]);
    }
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].content.slice(0, max - step)).toBe(
        chunks[i - 1].content.slice(step, max),
      );
    }
  });

  it("keeps final content <= maxChunkChars for a long section under a heading trail", () => {
    const body = ["# Doc", "## Section", "x".repeat(500)].join("\n\n");
    const max = 300;
    const overlap = 50;
    const chunks = chunkMarkdown(body, {
      maxChunkChars: max,
      overlapChars: overlap,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(max);
      expect(chunk.headings).toEqual(["# Doc", "## Section"]);
      expect(chunk.content).toContain("# Doc\n\n## Section");
    }
  });

  it("returns an empty array for an empty body", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only body", () => {
    expect(chunkMarkdown("  \n\t\n   ")).toEqual([]);
  });

  it("produces the same chunks for CRLF input as for LF input", () => {
    const lf = "# Title\n\nHello world.\n\n## Sub\n\nMore text.";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(chunkMarkdown(crlf)).toEqual(chunkMarkdown(lf));
  });

  it("uses the default max of 1500: a 1000-char body without headings fits in one chunk", () => {
    const chunks = chunkMarkdown("a".repeat(1000));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content.length).toBe(1000);
    expect(chunks[0].headings).toEqual([]);
  });

  it("uses the default max of 1500: a 4000-char body without headings splits into multiple chunks", () => {
    const chunks = chunkMarkdown("a".repeat(4000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(DEFAULT_MAX_CHUNK_CHARS);
    }
  });

  it("drops a section whose only content is a dataview fence", () => {
    const body = ["## Menções", "```dataview", "TASK FROM [[*]]", "```"]
      .join("\n");
    expect(chunkMarkdown(body)).toEqual([]);
  });

  it("skips dataviewjs fences regardless of info-string case", () => {
    const body = [
      "## Menções",
      "```DataviewJS",
      "console.log('oi')",
      "```",
      "### Outras",
      "Texto real.",
    ].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headings).toEqual(["## Menções", "### Outras"]);
    expect(chunks[0].content).toContain("Texto real.");
    expect(chunks[0].content).not.toContain("console.log");
  });

  it("keeps fences of other languages (e.g. python) intact", () => {
    const body = ["## Código", "```python", "print('oi')", "```"]
      .join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headings).toEqual(["## Código"]);
    expect(chunks[0].content).toContain("```python");
    expect(chunks[0].content).toContain("print('oi')");
  });

  it("preserves text outside a mid-section dataview fence", () => {
    const body = [
      "## Notas",
      "Antes do bloco.",
      "```dataview",
      "TABLE WITHOUT ID file.link",
      "```",
      "Depois do bloco.",
    ].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Antes do bloco.");
    expect(chunks[0].content).toContain("Depois do bloco.");
    expect(chunks[0].content).not.toContain("TABLE WITHOUT ID");
  });

  it("keeps the rest of the document when a dataview fence is never closed (fail-open)", () => {
    const body = [
      "## Menções",
      "```dataview",
      "TASK FROM [[*]]",
      "## Depois",
      "Texto importante.",
    ].join("\n");
    const chunks = chunkMarkdown(body);
    const all = chunks.map((chunk) => chunk.content).join("\n");
    expect(all).toContain("TASK FROM [[*]]");
    expect(all).toContain("Texto importante.");
  });

  it("prefixes chunks with contextLines + the last 2 headings, keeping the full trail in headings", () => {
    const body = ["# A", "## B", "### C", "Texto de C."].join("\n\n");
    const chunks = chunkMarkdown(body, { contextLines: ["Pessoas/Mayne.md"] });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headings).toEqual(["# A", "## B", "### C"]);
    expect(chunks[0].content).toBe(
      "Pessoas/Mayne.md\n\n## B\n\n### C\n\nTexto de C.",
    );
  });

  it("prefixes a section under a single heading with the context line + that heading", () => {
    const body = ["# A", "Texto de A."].join("\n\n");
    const chunks = chunkMarkdown(body, { contextLines: ["Pessoas/Mayne.md"] });
    expect(chunks[0].headings).toEqual(["# A"]);
    expect(chunks[0].content).toBe("Pessoas/Mayne.md\n\n# A\n\nTexto de A.");
  });

  it("limits the prefix to the last 2 headings of the trail when no contextLines are given", () => {
    const body = ["# A", "## B", "### C", "Texto de C."].join("\n\n");
    const chunks = chunkMarkdown(body);
    expect(chunks[0].headings).toEqual(["# A", "## B", "### C"]);
    expect(chunks[0].content).toBe("## B\n\n### C\n\nTexto de C.");
  });
});
