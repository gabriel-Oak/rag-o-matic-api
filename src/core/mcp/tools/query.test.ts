import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Left, Right } from '../../utils/types.js';
import HttpError from '../../utils/errors/http-error.js';
import type QueryContentUsecase from '../../features/query/usecases/query-content-usecase.js';
import { registerQueryTool } from './query.js';

describe('registerQueryTool (in-memory transport pair)', () => {
  let client: Client;
  let server: McpServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = new McpServer({ name: 'test-server', version: '1.0.0' });

    execute = vi.fn();
    const queryContent = { execute } as unknown as QueryContentUsecase;
    registerQueryTool(server, { queryContent });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the query tool with a non-empty description', async () => {
    const { tools } = await client.listTools();

    const tool = tools.find((t) => t.name === 'query');
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
    expect(tool?.inputSchema?.properties?.sourcePrefix).toBeDefined();
  });

  it('returns the QueryResult JSON when the usecase resolves Right', async () => {
    const result = {
      query: 'apple',
      count: 2,
      results: [
        {
          score: 0.91,
          source: 'apple-note.md',
          type: 'markdown',
          chunkIndex: 0,
          headings: ['Apple'],
          content: 'Apple content',
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          score: 0.82,
          source: 'fruit.md',
          type: 'markdown',
          chunkIndex: 1,
          headings: ['Fruit', 'Apples'],
          content: 'More apple content',
          indexedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    };
    execute.mockResolvedValue(new Right(result));

    const response = (await client.callTool({
      name: 'query',
      arguments: { q: 'apple' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as typeof result;
    expect(payload).toEqual(result);
    expect(payload.count).toBe(2);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ q: 'apple', limit: 5 });
  });

  it('passes sourcePrefix to the usecase', async () => {
    execute.mockResolvedValue(
      new Right({ query: 'apple', count: 0, results: [] }),
    );

    const response = (await client.callTool({
      name: 'query',
      arguments: { q: 'apple', sourcePrefix: 'Pessoas/' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      q: 'apple',
      limit: 5,
      sourcePrefix: 'Pessoas/',
    });
  });

  it('trims sourcePrefix before passing it to the usecase', async () => {
    execute.mockResolvedValue(
      new Right({ query: 'apple', count: 0, results: [] }),
    );

    const response = (await client.callTool({
      name: 'query',
      arguments: { q: 'apple', sourcePrefix: '  Pessoas/  ' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      q: 'apple',
      limit: 5,
      sourcePrefix: 'Pessoas/',
    });
  });

  it.each(['', '   '])(
    'rejects empty/whitespace-only sourcePrefix (%j) without calling the usecase',
    async (sourcePrefix) => {
      const response = (await client.callTool({
        name: 'query',
        arguments: { q: 'apple', sourcePrefix },
      })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      expect(response.isError).toBe(true);
      const block = response.content?.[0];
      expect(block?.type).toBe('text');
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('passes an explicit limit to the usecase', async () => {
    execute.mockResolvedValue(
      new Right({ query: 'apple', count: 0, results: [] }),
    );

    const response = (await client.callTool({
      name: 'query',
      arguments: { q: 'apple', limit: 10 },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ q: 'apple', limit: 10 });
  });

  it('returns isError with the HttpError payload when the usecase resolves Left', async () => {
    execute.mockResolvedValue(
      new Left(
        new HttpError({
          message: 'failed to embed query',
          statusCode: 502,
          meta: { ollama: 'unavailable' },
        }),
      ),
    );

    const response = (await client.callTool({
      name: 'query',
      arguments: { q: 'apple' },
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
    expect(payload.error).toBe('failed to embed query');
    expect(payload.status).toBe(502);
    expect(payload.meta).toEqual({ ollama: 'unavailable' });
  });

  it('rejects an empty q with isError without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'query',
      arguments: { q: '' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([0, 21])(
    'rejects limit: %i with isError without calling the usecase',
    async (limit) => {
      const response = (await client.callTool({
        name: 'query',
        arguments: { q: 'apple', limit },
      })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      expect(response.isError).toBe(true);
      const block = response.content?.[0];
      expect(block?.type).toBe('text');
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
