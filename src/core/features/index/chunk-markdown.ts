export const DEFAULT_MAX_CHUNK_CHARS = 1500;
export const DEFAULT_OVERLAP_CHARS = 200;

export interface ChunkMarkdownOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

export interface MarkdownChunk {
  content: string;
  headings: string[];
}

/**
 * A markdown heading line: 1-6 `#` followed by whitespace and a non-space
 * char (e.g. `# Title`, `## Sub`).
 */
const HEADING_PATTERN = /^(#{1,6})\s+\S/;

interface HeadingFrame {
  level: number;
  line: string;
}

interface Section {
  trail: string[];
  text: string;
}

/**
 * Walks the document line by line keeping a heading stack (pop while
 * `top.level >= N`, then push), and groups the lines between headings into
 * sections. The pre-heading part is a section with trail `[]`. Sections with
 * empty text are dropped.
 */
function collectSections(body: string): Section[] {
  const stack: HeadingFrame[] = [];
  const sections: Section[] = [];
  let trail: string[] = [];
  let sectionLines: string[] = [];

  const flush = (): void => {
    const text = sectionLines.join("\n").trim();
    if (text !== "") {
      sections.push({ trail, text });
    }
    sectionLines = [];
  };

  for (const line of body.split("\n")) {
    const match = HEADING_PATTERN.exec(line);
    if (match === null) {
      sectionLines.push(line);
      continue;
    }

    flush();
    const level = match[1].length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ level, line });
    trail = stack.map((heading) => heading.line);
  }
  flush();

  return sections;
}

/**
 * Splits section text into paragraphs: blocks separated by 2+ newlines,
 * trimmed, empties dropped.
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

/**
 * Hard windows over a paragraph: `p.slice(i, i + max)` for
 * `i = 0, step, 2*step, ...` while `i < p.length`, with
 * `step = max - overlap` (guarded to be at least 1).
 */
function hardWindows(paragraph: string, max: number, overlap: number): string[] {
  const step = Math.max(1, max - overlap);
  const windows: string[] = [];
  for (let i = 0; i < paragraph.length; i += step) {
    windows.push(paragraph.slice(i, i + max));
  }
  return windows;
}

/**
 * Packs the paragraphs of an oversized section into pieces of at most
 * `max` chars: accumulate paragraphs until the next one would overflow,
 * then emit and restart with a tail overlap (dropped when it would
 * overflow). A single paragraph bigger than `max` is emitted as hard
 * windows.
 */
function packSection(text: string, max: number, overlap: number): string[] {
  const pieces: string[] = [];
  let buffer = "";

  for (const paragraph of splitIntoParagraphs(text)) {
    if (paragraph.length > max) {
      if (buffer !== "") {
        pieces.push(buffer);
        buffer = "";
      }
      pieces.push(...hardWindows(paragraph, max, overlap));
      continue;
    }

    if (buffer === "" || (buffer + "\n\n" + paragraph).length <= max) {
      buffer = buffer === "" ? paragraph : buffer + "\n\n" + paragraph;
      continue;
    }

    pieces.push(buffer);
    const tail = buffer.slice(-overlap);
    buffer =
      (tail + "\n\n" + paragraph).length <= max
        ? tail + "\n\n" + paragraph
        : paragraph;
  }

  if (buffer !== "") {
    pieces.push(buffer);
  }

  return pieces;
}

/**
 * Splits a markdown body into embeddable chunks. Each chunk carries the
 * heading trail active at its section (as `headings`, and prefixed to
 * `content` for embedding context) plus a piece of the section text, with
 * `overlapChars` of tail overlap between consecutive pieces of the same
 * section. The final `content` (heading prefix + piece) never exceeds
 * `maxChunkChars`: pieces are packed against the budget left by the prefix.
 *
 * Empty / whitespace-only bodies return `[]`.
 */
export function chunkMarkdown(
  body: string,
  opts?: ChunkMarkdownOptions,
): MarkdownChunk[] {
  const max = opts?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const overlap = opts?.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const normalized = body.replace(/\r\n/g, "\n");
  if (normalized.trim() === "") {
    return [];
  }

  const chunks: MarkdownChunk[] = [];

  for (const section of collectSections(normalized)) {
    const prefix = section.trail.length > 0 ? section.trail.join("\n\n") : "";
    const separator = prefix !== "" ? "\n\n" : "";
    // Budget left for the section text so prefix + piece stays <= max
    // (clamped to 1 when the trail alone is >= max, degenerate case).
    const pieceMax = Math.max(1, max - prefix.length - separator.length);
    const full = prefix !== "" ? prefix + separator + section.text : section.text;

    if (full.length <= max) {
      chunks.push({ content: full, headings: section.trail });
      continue;
    }

    for (const piece of packSection(section.text, pieceMax, overlap)) {
      chunks.push({
        content: prefix !== "" ? prefix + separator + piece : piece,
        headings: section.trail,
      });
    }
  }

  return chunks;
}
