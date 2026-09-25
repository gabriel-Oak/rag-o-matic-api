import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import app from './app.js';

describe('fastify app', () => {
  it('GET /health returns 200 with { status: "ok" }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET unknown route returns 404 with HttpError shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    // fastify serializes the sent HttpError through its default error handler
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe("Error, looks like the route you are looking for has been removed or doesn't exists");
  });
});
