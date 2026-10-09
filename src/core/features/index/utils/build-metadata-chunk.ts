import {
  type MarkdownChunk,
  hardWindows,
} from "./chunk-markdown.js";

export interface BuildMetadataChunkOptions {
  /** Raw frontmatter YAML, exactly as it appears in the file. */
  frontmatter: string;
  /** Source path line (e.g. `Pessoas/Mayne.md`). */
  source: string;
  /** Max chars per chunk content (prefix included). */
  maxChunkChars: number;
}

/**
 * Builds the dedicated metadata chunk(s) for a document's frontmatter:
 * the raw YAML under a `## Metadados` heading, prefixed with the source.
 *
 * Returns `[]` when `frontmatter` is empty/absent. When the content
 * exceeds `maxChunkChars`, the YAML is sliced into hard windows (no
 * overlap: complete, non-duplicated coverage) and every piece keeps the
 * `source + "## Metadados"` prefix.
 */
export function buildMetadataChunk({
  frontmatter,
  source,
  maxChunkChars,
}: BuildMetadataChunkOptions): MarkdownChunk[] {
  if (frontmatter.trim() === "") {
    return [];
  }

  const heading = "## Metadados";
  const prefix = [source, heading].join("\n\n");
  const separator = "\n\n";
  const content = prefix + separator + frontmatter;

  if (content.length <= maxChunkChars) {
    return [{ content, headings: [heading] }];
  }

  // Budget left for the YAML so prefix + piece stays <= maxChunkChars
  // (clamped to 1 when the prefix alone is >= maxChunkChars, degenerate).
  const pieceMax = Math.max(1, maxChunkChars - prefix.length - separator.length);
  return hardWindows(frontmatter, pieceMax, 0).map((piece) => ({
    content: prefix + separator + piece,
    headings: [heading],
  }));
}
