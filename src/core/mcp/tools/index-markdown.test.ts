import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Left, Right } from '../../utils/types.js';
import HttpError from '../../utils/errors/http-error.js';
import type IndexContentUsecase from '../../features/index/usecases/index-content-usecase.js';
import { registerIndexMarkdownTool } from './index-markdown.js';

const accentText =
  '## Terapia\n\nConteúdo com acentos áéíóú e emoji 🧠';
const frontmatterText = '---\ntags: [x]\n---\n\n# T';

describe('registerIndexMarkdownTool (in-memory transport pair)', () => {
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
    registerIndexMarkdownTool(server, { indexContent });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the index_markdown tool with a non-empty description', async () => {
    const { tools } = await client.listTools();

    const tool = tools.find((t) => t.name === 'index_markdown');
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  it('round-trips UTF-8 text (accents + emoji) as base64 and calls execute with type markdown', async () => {
    const result = {
      source: 'terapia.md',
      type: 'markdown' as const,
      model: 'bge-m3',
      chunkCount: 1,
      upserted: 1,
    };
    execute.mockResolvedValue(new Right(result));

    const response = (await client.callTool({
      name: 'index_markdown',
      arguments: { content: accentText, source: 'terapia.md' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as typeof result;
    expect(payload).toEqual(result);

    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0]?.[0] as {
      type: string;
      content: string;
      source: string;
    };
    expect(arg.type).toBe('markdown');
    expect(arg.source).toBe('terapia.md');
    expect(Buffer.from(arg.content, 'base64').toString('utf8')).toBe(accentText);
  });

  it('passes YAML frontmatter at the top of the text intact (same round-trip)', async () => {
    execute.mockResolvedValue(
      new Right({
        source: 'note.md',
        type: 'markdown' as const,
        model: 'bge-m3',
        chunkCount: 1,
        upserted: 1,
      }),
    );

    const response = (await client.callTool({
      name: 'index_markdown',
      arguments: { content: frontmatterText, source: 'note.md' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(response.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0]?.[0] as {
      type: string;
      content: string;
    };
    expect(arg.type).toBe('markdown');
    expect(Buffer.from(arg.content, 'base64').toString('utf8')).toBe(
      frontmatterText,
    );
  });

  it('rejects empty source without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'index_markdown',
      arguments: { content: '# T', source: '' },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    // Empty source fails the tool input schema (z.string().min(1)) before the
    // handler runs: the SDK surfaces it as a tool error (isError: true).
    expect(response.isError).toBe(true);
    const block = response.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    expect(block.text).toContain('Invalid arguments');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects chunking with overlapChars >= maxChunkChars with 400 without calling the usecase', async () => {
    const response = (await client.callTool({
      name: 'index_markdown',
      arguments: {
        content: '# T',
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

  it('returns isError with the HttpError payload when the usecase resolves Left (502)', async () => {
    execute.mockResolvedValue(
      new Left(
        new HttpError({
          message: 'failed to embed content',
          statusCode: 502,
          meta: { reason: 'ollama-unavailable' },
        }),
      ),
    );

    const response = (await client.callTool({
      name: 'index_markdown',
      arguments: { content: '# T', source: 'note.md' },
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
    expect(payload.error).toBe('failed to embed content');
    expect(payload.status).toBe(502);
    expect(payload.meta).toEqual({ reason: 'ollama-unavailable' });
  });
});
