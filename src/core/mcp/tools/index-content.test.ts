import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Left, Right } from '../../utils/types.js';
import HttpError from '../../utils/errors/http-error.js';
import type IndexContentUsecase from '../../features/index/usecases/index-content-usecase.js';
import { registerIndexContentTool } from './index-content.js';

const sampleMarkdown = '# Title\n\nHello world';
const sampleBase64 = Buffer.from(sampleMarkdown, 'utf8').toString('base64');

describe('registerIndexContentTool (in-memory transport pair)', () => {
  let client: Client;
  let server: McpServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = new McpServer({ name: 'test-server', version: '1.0.0' });

    execute = vi.fn();
    const indexContent = { execute } as unknown as IndexContentUsecase;
    registerIndexContentTool(server, { indexContent });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the index_content tool with a non-empty description', async () => {
    const { tools } = await client.listTools();

    const tool = tools.find((t) => t.name === 'index_content');
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  it('returns the IndexResult JSON when the usecase resolves Right', async () => {
    const result = {
      source: 'note.md',
      type: 'markdown' as const,
      model: 'bge-m3',
      chunkCount: 2,
      upserted: 2,
    };
    execute.mockResolvedValue(new Right(result));

    const response = (await client.callTool({
      name: 'index_content',
      arguments: {
        type: 'markdown',
        content: sampleBase64,
        source: 'note.md',
        chunking: { maxChunkChars: 500, overlapChars: 50 },
      },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as typeof result;
    expect(payload).toEqual(result);
    expect(payload.chunkCount).toBe(2);
    expect(payload.upserted).toBe(2);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      type: 'markdown',
      content: sampleBase64,
      source: 'note.md',
      chunking: { maxChunkChars: 500, overlapChars: 50 },
    });
  });

  it('returns isError with the HttpError payload when the usecase resolves Left', async () => {
    execute.mockResolvedValue(
      new Left(
        new HttpError({
          message: 'no chunks produced from the provided content',
          statusCode: 422,
          meta: { reason: 'empty-content' },
        }),
      ),
    );

    const response = (await client.callTool({
      name: 'index_content',
      arguments: { type: 'markdown', content: sampleBase64, source: 'note.md' },
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
    expect(payload.error).toBe('no chunks produced from the provided content');
    expect(payload.status).toBe(422);
    expect(payload.meta).toEqual({ reason: 'empty-content' });
  });

  it('rejects non-base64 content with 400 without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'index_content',
      arguments: { type: 'markdown', content: 'abc', source: 'note.md' },
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
    expect(payload.error).toBe('invalid request');
    expect(payload.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects chunking with overlapChars >= maxChunkChars with 400 without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'index_content',
      arguments: {
        type: 'markdown',
        content: sampleBase64,
        source: 'note.md',
        chunking: { maxChunkChars: 100, overlapChars: 100 },
      },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as { error: string; status: number };
    expect(payload.error).toBe('invalid request');
    expect(payload.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
