import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from './mcp-server.js';

describe('createMcpServer (in-memory transport pair)', () => {
  let client: Client;
  let server: McpServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer({ model: 'bge-m3', collection: 'vault_notes', dimension: 1024 });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the health tool with a description', async () => {
    const { tools } = await client.listTools();

    const health = tools.find((tool) => tool.name === 'health');
    expect(health).toBeDefined();
    expect(health?.description).toBeTruthy();
    expect(health?.description).toMatch(/health/i);
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
