import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type DeleteSourceUsecase from '../../features/delete/usecases/delete-source-usecase.js';
import type { DeleteSourceResult } from '../../features/delete/models/types.js';
import type { Either } from '../../utils/types.js';
import type HttpError from '../../utils/errors/http-error.js';

const deleteRequestSchema = z.object({
  source: z.string().min(1),
});

export interface DeleteContentToolDeps {
  deleteSource: DeleteSourceUsecase;
}

export function registerDeleteContentTool(
  server: McpServer,
  deps: DeleteContentToolDeps,
): void {
  server.registerTool(
    'delete_content',
    {
      title: 'Delete content',
      description:
        'Delete all chunks indexed under a given source from the vector store. Idempotent: deleting an unknown source succeeds with deleted: 0. Returns { source, deleted }.',
      inputSchema: {
        source: z.string().min(1),
      },
    },
    async (args) => {
      const parsed = deleteRequestSchema.safeParse(args);
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

      const result: Either<HttpError, DeleteSourceResult> =
        await deps.deleteSource.execute(parsed.data.source);
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
