import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Left, Right } from '../../utils/types.js';
import HttpError from '../../utils/errors/http-error.js';
import type ListSourcesUsecase from '../../features/query/usecases/list-sources-usecase.js';
import { registerListSourcesTool } from './list-sources.js';

describe('registerListSourcesTool (in-memory transport pair)', () => {
  let client: Client;
  let server: McpServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = new McpServer({ name: 'test-server', version: '1.0.0' });

    execute = vi.fn();
    const listSources = { execute } as unknown as ListSourcesUsecase;
    registerListSourcesTool(server, { listSources });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the list_sources tool with the expected description', async () => {
    const { tools } = await client.listTools();

    const tool = tools.find((t) => t.name === 'list_sources');
    expect(tool).toBeDefined();
    expect(tool?.description).toBe(
      'List indexed sources (notes/PDFs) with chunk counts. Optional `prefix` filters by folder path (e.g. "Projetos/"). Use to answer "what notes exist" / "list X" questions; then call `query` for content.',
    );
  });

  it('returns all sources when called without a prefix', async () => {
    const result = {
      sources: [
        { source: 'a.md', chunks: 1 },
        { source: 'b.md', chunks: 2 },
      ],
      count: 2,
    };
    execute.mockResolvedValue(new Right(result));

    const response = (await client.callTool({
      name: 'list_sources',
      arguments: {},
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    expect(JSON.parse(block.text)).toEqual(result);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(undefined);
  });

  it('propagates the prefix to the usecase', async () => {
    execute.mockResolvedValue(new Right({ sources: [], count: 0 }));

    const response = (await client.callTool({
      name: 'list_sources',
      arguments: { prefix: 'Projetos/' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('Projetos/');
  });

  it('returns isError with the HttpError payload when the usecase resolves Left', async () => {
    execute.mockResolvedValue(
      new Left(
        new HttpError({
          message: 'failed to list sources',
          statusCode: 502,
          meta: { reason: 'qdrant-error' },
        }),
      ),
    );

    const response = (await client.callTool({
      name: 'list_sources',
      arguments: {},
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
    expect(payload.error).toBe('failed to list sources');
    expect(payload.status).toBe(502);
    expect(payload.meta).toEqual({ reason: 'qdrant-error' });
  });

  it('rejects an empty prefix without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'list_sources',
      arguments: { prefix: '' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;
    expect(block.text).toMatch(/Invalid arguments/);
    expect(execute).not.toHaveBeenCalled();
  });
});
