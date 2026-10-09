import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type QueryContentUsecase from '../../features/query/usecases/query-content-usecase.js';
import {
  queryRequestSchema,
  type QueryResult,
} from '../../features/query/models/types.js';
import type { Either } from '../../utils/types.js';
import type HttpError from '../../utils/errors/http-error.js';

export interface QueryToolDeps {
  queryContent: QueryContentUsecase;
}

export function registerQueryTool(
  server: McpServer,
  deps: QueryToolDeps,
): void {
  server.registerTool(
    'query',
    {
      title: 'Query',
      description:
        'Semantic top-k search over indexed notes. Embeds `q` via Ollama and returns the most relevant chunks with score, source, type, chunkIndex, headings, content and indexedAt. Hits may include `frontmatter` (raw YAML of the note, when the note has frontmatter). An empty result is not an error.',
      inputSchema: {
        q: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const parsed = queryRequestSchema.safeParse({
        q: args.q,
        limit: args.limit ?? 5,
      });
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

      const result: Either<HttpError, QueryResult> =
        await deps.queryContent.execute(parsed.data);
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
