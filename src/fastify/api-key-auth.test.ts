import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import app from './app.js';

process.env.OLLAMA_URL ??= 'http://localhost:11434';
process.env.QDRANT_URL ??= 'http://localhost:6333';
process.env.API_KEY ??= 'test-key';

const MCP_ACCEPT = 'application/json, text/event-stream';

describe('api-key-auth (preHandler on real app)', () => {
  it('GET /health without header → 200 (skipped route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /query without header → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/query?q=x' });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe('Unauthorized');
  });

  it('GET /query with wrong key → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=x',
      headers: { authorization: 'Bearer wrong' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Unauthorized');
  });

  it('GET /query with valid key → not 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=x',
      headers: { authorization: 'Bearer test-key' },
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('lowercase "bearer" scheme is accepted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=x',
      headers: { authorization: 'bearer test-key' },
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('non-Bearer scheme (Basic) → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=x',
      headers: { authorization: 'Basic abc' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Unauthorized');
  });
});

describe('api-key-auth on MCP (POST /mcp)', () => {
  const initializePayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  };

  it('initialize without key → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: MCP_ACCEPT },
      payload: initializePayload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Unauthorized');
  });

  it('initialize with key → 200 + mcp-session-id; tools/list with valid session but no key → 401', async () => {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: MCP_ACCEPT,
        authorization: 'Bearer test-key',
      },
      payload: initializePayload,
    });

    expect(init.statusCode).toBe(200);
    const sessionId = init.headers['mcp-session-id'];
    expect(typeof sessionId).toBe('string');
    expect((sessionId as string).length).toBeGreaterThan(0);

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

    expect(list.statusCode).toBe(401);
    expect(list.json().message).toBe('Unauthorized');
  });
});
