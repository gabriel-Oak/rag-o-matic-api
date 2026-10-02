import { z } from "zod";

export const queryRequestSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;

export interface QueryHit {
  score: number;
  source: string;
  type: string;
  chunkIndex: number;
  headings: string[];
  content: string;
  indexedAt: string;
}

export interface QueryResult {
  query: string;
  count: number;
  results: QueryHit[];
}
