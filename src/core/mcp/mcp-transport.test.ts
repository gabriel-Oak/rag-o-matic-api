import 'reflect-metadata';
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
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'delete_content',
      'health',
      'index_content',
      'index_markdown',
      'list_sources',
      'query',
    ]);
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

describe('MCP session lifecycle (initialize → health → DELETE → session gone)', () => {
  const postMcp = (payload: unknown, sessionId?: string) =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: MCP_ACCEPT,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      payload,
    });

  it('closes the session on DELETE and rejects the dead session id afterwards', async () => {
    // 1. initialize → session id
    const init = await postMcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    expect(init.statusCode).toBe(200);
    const sessionId = init.headers['mcp-session-id'];
    expect(typeof sessionId).toBe('string');
    expect((sessionId as string).length).toBeGreaterThan(0);

    // 2. tools/call health with the session id → 200, text content parses as
    //    JSON with status "ok" + RAG config
    const health = await postMcp(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'health', arguments: {} },
      },
      sessionId as string,
    );

    expect(health.statusCode).toBe(200);
    const healthResult = parseSseJson(health.body).result as {
      content: { type: string; text: string }[];
    };
    expect(healthResult.content).toHaveLength(1);
    expect(healthResult.content[0].type).toBe('text');

    const healthPayload = JSON.parse(healthResult.content[0].text) as {
      status: string;
      uptime: number;
      config: { model: string; collection: string; dimension: number };
    };
    expect(healthPayload.status).toBe('ok');
    expect(healthPayload.uptime).toBeTypeOf('number');
    expect(healthPayload.config.model).toBeTypeOf('string');
    expect(healthPayload.config.collection).toBeTypeOf('string');
    expect(healthPayload.config.dimension).toBeTypeOf('number');

    // 3. DELETE with the session id → 200, session closed
    const del = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { 'mcp-session-id': sessionId as string },
    });

    expect(del.statusCode).toBe(200);

    // 4. The session id is gone:
    //    - DELETE again (findSession miss) → 404 "Session not found"
    const delAgain = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { 'mcp-session-id': sessionId as string },
    });

    expect(delAgain.statusCode).toBe(404);
    expect(delAgain.json()).toEqual({ error: 'Session not found' });

    //    - DELETE without any session id → 404 as well
    const delNoHeader = await app.inject({ method: 'DELETE', url: '/mcp' });

    expect(delNoHeader.statusCode).toBe(404);

    //    - tools/list with the dead session id → rejected. The POST route
    //      builds a fresh transport for unknown session ids (only GET/DELETE
    //      404 on a findSession miss), so the SDK rejects the non-initialize
    //      request on the uninitialized transport with 400.
    const listAfter = await postMcp(
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      sessionId as string,
    );

    expect(listAfter.statusCode).toBe(400);
    expect(listAfter.json().error).toEqual({
      code: -32000,
      message: 'Bad Request: Server not initialized',
    });
  });
});
