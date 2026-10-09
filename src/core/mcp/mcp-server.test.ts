import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type IndexContentUsecase from '../features/index/usecases/index-content-usecase.js';
import type QueryContentUsecase from '../features/query/usecases/query-content-usecase.js';
import type DeleteSourceUsecase from '../features/delete/usecases/delete-source-usecase.js';
import type ListSourcesUsecase from '../features/query/usecases/list-sources-usecase.js';
import { createMcpServer } from './mcp-server.js';

describe('createMcpServer (in-memory transport pair)', () => {
  let client: Client;
  let server: McpServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let indexContent: IndexContentUsecase;
  let queryContent: QueryContentUsecase;
  let deleteSource: DeleteSourceUsecase;
  let listSources: ListSourcesUsecase;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    indexContent = { execute: vi.fn() } as unknown as IndexContentUsecase;
    queryContent = { execute: vi.fn() } as unknown as QueryContentUsecase;
    deleteSource = { execute: vi.fn() } as unknown as DeleteSourceUsecase;
    listSources = { execute: vi.fn() } as unknown as ListSourcesUsecase;

    server = createMcpServer({
      model: 'bge-m3',
      collection: 'vault_notes',
      dimension: 1024,
      indexContent,
      queryContent,
      deleteSource,
      listSources,
    });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the 6 tools (health, index_content, index_markdown, query, delete_content, list_sources) with descriptions', async () => {
    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'delete_content',
      'health',
      'index_content',
      'index_markdown',
      'list_sources',
      'query',
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it('calls health and returns status ok + RAG config as JSON text', async () => {
    const result = (await client.callTool({ name: 'health', arguments: {} })) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const block = result.content?.[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text' || typeof block.text !== 'string') return;

    const payload = JSON.parse(block.text) as {
      status: string;
      uptime: number;
      config: { model: string; collection: string; dimension: number };
    };
    expect(payload.status).toBe('ok');
    expect(typeof payload.uptime).toBe('number');
    expect(payload.config).toEqual({
      model: 'bge-m3',
      collection: 'vault_notes',
      dimension: 1024,
    });
  });
});
