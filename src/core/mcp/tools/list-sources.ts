import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type ListSourcesUsecase from '../../features/query/usecases/list-sources-usecase.js';
import type { ListSourcesResult } from '../../features/query/models/types.js';
import type { Either } from '../../utils/types.js';
import type HttpError from '../../utils/errors/http-error.js';

const listSourcesRequestSchema = z.object({
  prefix: z.string().min(1).optional(),
});

export interface ListSourcesToolDeps {
  listSources: ListSourcesUsecase;
}

export function registerListSourcesTool(
  server: McpServer,
  deps: ListSourcesToolDeps,
): void {
  server.registerTool(
    'list_sources',
    {
      title: 'List sources',
      description:
        'List indexed sources (notes/PDFs) with chunk counts. Optional `prefix` filters by folder path (e.g. "Projetos/"). Use to answer "what notes exist" / "list X" questions; then call `query` for content.',
      inputSchema: {
        prefix: z.string().min(1).optional(),
      },
    },
    async (args) => {
      const parsed = listSourcesRequestSchema.safeParse(args);
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

      const result: Either<HttpError, ListSourcesResult> =
        await deps.listSources.execute(parsed.data.prefix);
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
