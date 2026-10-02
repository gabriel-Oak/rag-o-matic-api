import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type IndexContentUsecase from '../../features/index/usecases/index-content-usecase.js';
import {
  indexRequestSchema,
  type IndexResult,
} from '../../features/index/models/types.js';
import type { Either } from '../../utils/types.js';
import type HttpError from '../../utils/errors/http-error.js';

export interface IndexContentToolDeps {
  indexContent: IndexContentUsecase;
}

export function registerIndexContentTool(
  server: McpServer,
  deps: IndexContentToolDeps,
): void {
  server.registerTool(
    'index_content',
    {
      title: 'Index content',
      description:
        'Index a document (markdown or PDF) into the RAG vector store. `content` is the base64 encoding of the file bytes. Re-indexing the same `source` replaces its previous chunks. Returns source, type, model, chunkCount and upserted. For plain-text markdown (no base64), use `index_markdown` instead.',
      inputSchema: {
        type: z.enum(['markdown', 'pdf']),
        content: z.string().min(1),
        source: z.string().min(1),
        chunking: z
          .object({
            maxChunkChars: z.number().int().positive().optional(),
            overlapChars: z.number().int().positive().optional(),
          })
          .optional(),
      },
    },
    async (args) => {
      const parsed = indexRequestSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'invalid request',
                status: 400,
                meta: parsed.error.issues,
              }),
            },
          ],
          isError: true,
        };
      }

      const result: Either<HttpError, IndexResult> =
        await deps.indexContent.execute(parsed.data);
      if (result.isError) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: result.error.message,
                status: result.error.statusCode,
                meta: result.error.meta,
              }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result.success) }],
      };
    },
  );
}
