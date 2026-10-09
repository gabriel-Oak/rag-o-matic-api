import { createHash } from "node:crypto";

import type { VectorPoint } from "../../../utils/services/vector-database/types.js";
import type { SparseVectorEntry } from "./sparse-tf.js";

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
  /** One sparse vector per chunk, aligned by chunk index. */
  sparse?: Array<SparseVectorEntry[]>;
  /** Number of leading chunks that are metadata chunks. */
  metadataCount?: number;
}

/**
 * Builds one Qdrant point per chunk. `indexedAt` is passed in (never
 * generated here) so all chunks of a document share one timestamp and the
 * function stays pure. The `frontmatter` payload key is only present when
 * `args.frontmatter` is defined. The first `metadataCount` chunks get
 * payload `type: "metadata"` (overriding the document type); the rest keep
 * `args.type`. `sparse` entries are attached per point when provided.
 */
export function buildPoints(args: BuildPointsArgs): VectorPoint[] {
  const {
    source,
    type,
    chunks,
    embeddings,
    frontmatter,
    indexedAt,
    sparse,
    metadataCount = 0,
  } = args;

  return chunks.map((chunk, i) => {
    const sparseVector = sparse?.[i];
    return {
      id: pointId(source, i),
      vector: embeddings[i],
      ...(sparseVector !== undefined ? { sparse: sparseVector } : {}),
      payload: {
        source,
        type: i < metadataCount ? "metadata" : type,
        chunkIndex: i,
        content: chunk.content,
        headings: chunk.headings,
        ...(frontmatter !== undefined ? { frontmatter } : {}),
        indexedAt,
      },
    };
  });
}
