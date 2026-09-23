import { createHash } from "node:crypto";

import type { QdrantPoint } from "../../utils/services/qdrant/types.js";

/**
 * Deterministic Qdrant point ID: `sha256(`${source}#${chunkIndex}`)` in hex
 * (64 chars). Same source + chunk index always maps to the same ID, so
 * re-indexing a note overwrites the same points.
 */
export function pointId(source: string, chunkIndex: number): string {
  return createHash("sha256")
    .update(`${source}#${chunkIndex}`)
    .digest("hex");
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
export function buildPoints(args: BuildPointsArgs): QdrantPoint[] {
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
