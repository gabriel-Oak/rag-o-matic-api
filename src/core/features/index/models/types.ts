import { z } from "zod";

import BaseError from "../../../utils/errors/base-error.js";
import {
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_OVERLAP_CHARS,
} from "../chunk-markdown.js";

export class ExtractError extends BaseError {
  readonly type = "extract-error";
}

export const indexRequestSchema = z.object({
  type: z.literal("markdown").or(z.literal("pdf")),
  content: z.base64(),
  source: z.string().optional(),
  chunking: z
    .object({
      maxChunkChars: z.number().int().positive().optional(),
      overlapChars: z.number().int().positive().optional(),
    })
    .refine(
      (chunking) => {
        const effectiveMax =
          chunking.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
        const effectiveOverlap =
          chunking.overlapChars ?? DEFAULT_OVERLAP_CHARS;
        return effectiveOverlap < effectiveMax;
      },
      {
        message: "overlapChars must be less than maxChunkChars",
      },
    )
    .optional(),
});

export type IndexRequest = z.infer<typeof indexRequestSchema>;

export interface Chunk {
  index: number;
  headings: string[];
  content: string;
  charCount: number;
  metadata: { frontmatter?: string };
  embedding: number[];
}

export interface IndexResult {
  source?: string;
  type: "markdown" | "pdf";
  model: string;
  chunkCount: number;
  chunks: Chunk[];
}
