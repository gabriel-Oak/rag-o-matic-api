import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Left, Right } from '../../utils/types.js';
import HttpError from '../../utils/errors/http-error.js';
import type DeleteSourceUsecase from '../../features/delete/usecases/delete-source-usecase.js';
import { registerDeleteContentTool } from './delete-content.js';

describe('registerDeleteContentTool (in-memory transport pair)', () => {
  let client: Client;
  let server: McpServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = new McpServer({ name: 'test-server', version: '1.0.0' });

    execute = vi.fn();
    const deleteSource = { execute } as unknown as DeleteSourceUsecase;
    registerDeleteContentTool(server, { deleteSource });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the delete_content tool with a non-empty description', async () => {
    const { tools } = await client.listTools();

    const tool = tools.find((t) => t.name === 'delete_content');
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  it('returns the DeleteSourceResult JSON when the usecase resolves Right', async () => {
    const result = { source: 'note.md', deleted: 3 };
    execute.mockResolvedValue(new Right(result));

    const response = (await client.callTool({
      name: 'delete_content',
      arguments: { source: 'note.md' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as typeof result;
    expect(payload).toEqual(result);
    expect(payload.source).toBe('note.md');
    expect(payload.deleted).toBe(3);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('note.md');
  });

  it('returns isError with the HttpError payload when the usecase resolves Left', async () => {
    execute.mockResolvedValue(
      new Left(
        new HttpError({
          message: 'failed to delete points for source',
          statusCode: 502,
          meta: { reason: 'qdrant-error' },
        }),
      ),
    );

    const response = (await client.callTool({
      name: 'delete_content',
      arguments: { source: 'note.md' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as {
      error: string;
      status: number;
      meta: unknown;
    };
    expect(payload.error).toBe('failed to delete points for source');
    expect(payload.status).toBe(502);
    expect(payload.meta).toEqual({ reason: 'qdrant-error' });
  });

  it('rejects an empty source with an error result without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'delete_content',
      arguments: { source: '' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;
    expect(block.text).toMatch(/Invalid arguments/);
    expect(execute).not.toHaveBeenCalled();
  });
});
