/**
 * Sparse TF vectors for hybrid (dense + sparse) retrieval.
 *
 * Pure utilities: no vocabulary is persisted — term indices are derived
 * deterministically from an FNV-1a 32-bit hash of the term itself, so the
 * same term always maps to the same index across runs and processes.
 * Collisions between distinct terms are harmless: their weights are summed
 * into the same index.
 */

/** One entry of a sparse vector: hashed term index + TF weight. */
export interface SparseVectorEntry {
  index: number;
  value: number;
}

/**
 * FNV-1a 32-bit hash of `text` (offset basis `0x811c9dc5`,
 * prime `0x01000193`), returned as an unsigned 32-bit integer.
 * Deterministic: same input always yields the same output.
 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Ordered tokenizer pattern: at each position the first matching
 * alternative wins (date > phone > number > word). Non-matching
 * characters act as separators and are skipped.
 */
const TOKEN_PATTERN =
  /(\d{4}-\d{2}-\d{2})|(\+\d[\d\s\-().]{5,}\d)|(\d+(?:[.-]\d+)*)|([a-z0-9]+)/g;

/**
 * Normalizes and tokenizes `text`:
 * 1. strips accents (NFD, drop combining marks) and lowercases;
 * 2. scans with ordered alternatives:
 *    - date `YYYY-MM-DD` → kept intact (e.g. `1998-01-20`);
 *    - phone `+...` → kept, with `[\s\-().]` stripped
 *      (`+55 11 96646-8234` → `+5511966468234`);
 *    - number (`\d+(?:[.-]\d+)*`) → kept intact;
 *    - word (`[a-z0-9]+`) → kept intact.
 */
export function tokenize(text: string): string[] {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(normalized)) !== null) {
    const [, date, phone, number, word] = match;
    if (date !== undefined) {
      tokens.push(date);
    } else if (phone !== undefined) {
      tokens.push(phone.replace(/[\s\-().]/g, ""));
    } else if (number !== undefined) {
      tokens.push(number);
    } else if (word !== undefined) {
      tokens.push(word);
    }
  }
  return tokens;
}

/**
 * Builds the sparse TF vector for `text`.
 *
 * Terms are the unigrams (the tokens) plus the bigrams (consecutive token
 * pairs joined by a single space). Each term gets weight
 * `1 + Math.log(count)` (count = occurrences in the term list). Term index
 * is `fnv1a(term)`; entries sharing an index (hash collision) are merged
 * by summing values. Result is sorted by index, zeros discarded;
 * empty/whitespace-only text yields `[]`.
 */
export function buildSparseVector(text: string): SparseVectorEntry[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();
  const countTerm = (term: string): void => {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  };
  for (const token of tokens) {
    countTerm(token);
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    countTerm(`${tokens[i]} ${tokens[i + 1]}`);
  }

  const byIndex = new Map<number, number>();
  for (const [term, count] of counts) {
    const index = fnv1a(term);
    const value = 1 + Math.log(count);
    byIndex.set(index, (byIndex.get(index) ?? 0) + value);
  }

  return [...byIndex.entries()]
    .filter(([, value]) => value > 0)
    .map(([index, value]) => ({ index, value }))
    .sort((a, b) => a.index - b.index);
}
