import { describe, expect, it } from "vitest";
import { buildMetadataChunk } from "./build-metadata-chunk.js";

describe("buildMetadataChunk", () => {
  it("returns an empty array for empty or whitespace-only frontmatter", () => {
    expect(
      buildMetadataChunk({
        frontmatter: "",
        source: "Pessoas/Mayne.md",
        maxChunkChars: 1500,
      }),
    ).toEqual([]);
    expect(
      buildMetadataChunk({
        frontmatter: "  \n\t ",
        source: "Pessoas/Mayne.md",
        maxChunkChars: 1500,
      }),
    ).toEqual([]);
  });

  it("builds a single chunk with source + '## Metadados' + raw YAML", () => {
    const frontmatter = "Telefone: +55 11 99999-0000\nAniversario: 1998-01-20";
    const chunks = buildMetadataChunk({
      frontmatter,
      source: "Pessoas/Mayne.md",
      maxChunkChars: 1500,
    });
    expect(chunks).toEqual([
      {
        content: "Pessoas/Mayne.md\n\n## Metadados\n\n" + frontmatter,
        headings: ["## Metadados"],
      },
    ]);
  });

  it("splits a YAML bigger than maxChunkChars into multiple chunks, all keeping the prefix", () => {
    const frontmatter = "k: " + "v".repeat(5000);
    const max = 500;
    const chunks = buildMetadataChunk({
      frontmatter,
      source: "a.md",
      maxChunkChars: max,
    });

    expect(chunks.length).toBeGreaterThan(1);
    const prefix = "a.md\n\n## Metadados\n\n";
    for (const chunk of chunks) {
      expect(chunk.headings).toEqual(["## Metadados"]);
      expect(chunk.content.startsWith(prefix)).toBe(true);
      expect(chunk.content.length).toBeLessThanOrEqual(max);
    }
    // Windows without overlap partition the YAML: full coverage, no dup.
    const joined = chunks
      .map((chunk) => chunk.content.slice(prefix.length))
      .join("");
    expect(joined).toBe(frontmatter);
  });
});
