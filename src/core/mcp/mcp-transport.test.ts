import { describe, expect, it } from 'vitest';
import app from '../../fastify/app.js';

// getEnv() (called when a session is created) requires these at request time.
process.env.OLLAMA_URL ??= 'http://localhost:11434';
process.env.QDRANT_URL ??= 'http://localhost:6333';

const MCP_ACCEPT = 'application/json, text/event-stream';

/**
 * MCP Streamable HTTP responses are SSE-framed: JSON-RPC messages arrive as
 * `data:` lines. Extract and parse them.
 */
function parseSseJson(body: string): Record<string, unknown> {
  const data = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('');
  return JSON.parse(data) as Record<string, unknown>;
}

describe('MCP over Streamable HTTP (POST /mcp)', () => {
  it('initializes a session and lists the health tool', async () => {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: MCP_ACCEPT },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      },
    });

    expect(init.statusCode).toBe(200);
    const sessionId = init.headers['mcp-session-id'];
    expect(typeof sessionId).toBe('string');
    expect((sessionId as string).length).toBeGreaterThan(0);

    const initResult = parseSseJson(init.body).result as {
      serverInfo: { name: string; version: string };
    };
    expect(initResult.serverInfo.name).toBe('rag-o-matic');

    const list = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: MCP_ACCEPT,
        'mcp-session-id': sessionId as string,
      },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });

    expect(list.statusCode).toBe(200);
    const tools = (parseSseJson(list.body).result as { tools: { name: string }[] }).tools;
    expect(tools.some((tool) => tool.name === 'health')).toBe(true);
  });

  it('rejects tools/list without a session id (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: MCP_ACCEPT },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });

    expect(res.statusCode).toBe(400);
  });
});
