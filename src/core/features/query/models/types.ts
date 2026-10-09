import { z } from "zod";

export const queryRequestSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  sourcePrefix: z.string().min(1).optional(),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;

export interface QueryHit {
  /**
   * RRF (Reciprocal Rank Fusion) score from the hybrid (dense + sparse)
   * search: ~0-1 range, higher is better. Not a cosine similarity.
   */
  score: number;
  source: string;
  type: string;
  chunkIndex: number;
  headings: string[];
  content: string;
  indexedAt: string;
  /**
   * Raw YAML frontmatter of the note, present only when the indexed point
   * payload carries a `frontmatter` key.
   */
  frontmatter?: string;
}

export interface QueryResult {
  query: string;
  count: number;
  results: QueryHit[];
}
