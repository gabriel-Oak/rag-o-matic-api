import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { indexRequestSchema } from '../../features/index/models/types.js';
import type { IndexResult } from '../../features/index/models/types.js';
import type { Either } from '../../utils/types.js';
import type HttpError from '../../utils/errors/http-error.js';
import type { IndexContentToolDeps } from './index-content.js';

export function registerIndexMarkdownTool(
  server: McpServer,
  deps: IndexContentToolDeps,
): void {
  server.registerTool(
    'index_markdown',
    {
      title: 'Index markdown',
      description:
        'Index plain markdown text (no base64) into the RAG vector store. Optional YAML frontmatter at the top of the text is supported. Re-indexing the same `source` replaces its previous chunks. Returns source, type, model, chunkCount and upserted. For PDFs or binary bytes, use `index_content` instead.',
      inputSchema: {
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
      const request = {
        type: 'markdown' as const,
        content: Buffer.from(args.content, 'utf8').toString('base64'),
        source: args.source,
        chunking: args.chunking,
      };

      const parsed = indexRequestSchema.safeParse(request);
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
