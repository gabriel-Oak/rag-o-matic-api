import { createHash } from "node:crypto";

import type { VectorPoint } from "../../utils/services/vector-database/types.js";

/**
 * Deterministic Qdrant point ID: first 16 bytes of
 * `sha256(`${source}#${chunkIndex}`)` formatted as a UUID (8-4-4-4-12).
 * Qdrant only accepts point IDs as an unsigned integer or a UUID, so the
 * raw 64-char hex (no dashes) is rejected. Using the first 16 bytes of the
 * sha256 keeps the ID deterministic (same source + chunk index always maps
 * to the same ID, so re-indexing a note overwrites the same points) without
 * adding a dependency.
 */
export function pointId(source: string, chunkIndex: number): string {
  const hash = createHash("sha256")
    .update(`${source}#${chunkIndex}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

export interface BuildPointsArgs {
  source: string;
  type: "markdown" | "pdf";
  chunks: Array<{ content: string; headings: string[] }>;
  embeddings: number[][];
  frontmatter?: string;
  indexedAt: string;
}

/**
 * Builds one Qdrant point per chunk. `indexedAt` is passed in (never
 * generated here) so all chunks of a document share one timestamp and the
 * function stays pure. The `frontmatter` payload key is only present when
 * `args.frontmatter` is defined.
 */
export function buildPoints(args: BuildPointsArgs): VectorPoint[] {
  const { source, type, chunks, embeddings, frontmatter, indexedAt } = args;

  return chunks.map((chunk, i) => ({
    id: pointId(source, i),
    vector: embeddings[i],
    payload: {
      source,
      type,
      chunkIndex: i,
      content: chunk.content,
      headings: chunk.headings,
      ...(frontmatter !== undefined ? { frontmatter } : {}),
      indexedAt,
    },
  }));
}
