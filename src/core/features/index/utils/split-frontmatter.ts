const BOM = "\uFEFF";

/**
 * Opening frontmatter delimiter: doc must START with `---` followed by a
 * newline (LF or CRLF). A leading BOM is tolerated.
 */
const OPENING_DELIMITER = /^---\r?\n/;

/**
 * Closing frontmatter delimiter: the FIRST line (after the opening block)
 * that is exactly `---`, tolerating a trailing `\r` or end-of-string.
 * The lazy prefix consumes whole lines one by one, so the first exact
 * `---` line wins — a `---` mid-line (e.g. `x---`) never matches.
 */
const CLOSING_DELIMITER = /^(?:[^\n]*\n)*?---(?:\r\n|\n|$)/;

export function splitFrontmatter(markdown: string): {
  frontmatter?: string;
  body: string;
} {
  const source = markdown.startsWith(BOM) ? markdown.slice(1) : markdown;

  const opening = OPENING_DELIMITER.exec(source);
  if (!opening) {
    return { body: markdown };
  }

  const afterOpening = source.slice(opening[0].length);
  const closing = CLOSING_DELIMITER.exec(afterOpening);
  if (!closing) {
    return { body: markdown };
  }

  const full = closing[0];
  const trailingNewline = full.endsWith("\r\n") ? 2 : full.endsWith("\n") ? 1 : 0;
  const frontmatter = full.slice(0, full.length - 3 - trailingNewline).trim();
  const body = afterOpening.slice(full.length);

  return frontmatter ? { frontmatter, body } : { body };
}
