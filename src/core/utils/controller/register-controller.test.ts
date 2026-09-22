import 'reflect-metadata';
import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import buildRoutes from './build-routes.js';
import controller from './decorators/controller.js';
import get from './decorators/get.js';
import post from './decorators/post.js';
import { ICreateController } from './types.js';

const mockError = vi.fn();
vi.mock('../services/logger/index.js', () => ({
  default: () => ({ error: mockError }),
}));

const createApp = (controllersFactory: ICreateController<object>[]) => {
  const app = fastify();
  buildRoutes(app, controllersFactory);
  return app;
};

@controller('/ping')
class PingController {
  @get('/')
  ping() {
    return { pong: true };
  }

  @post('/create')
  create() {
    return { created: true };
  }
}

class FooBarController {
  @get('/')
  index() {
    return { ok: true };
  }
}

@controller('/boom')
class BoomController {
  @get('/sync')
  sync() {
    throw new Error('sync boom');
  }

  @get('/rejecting')
  rejecting() {
    return Promise.reject(new Error('async boom'));
  }
}

describe('registerController (buildRoutes)', () => {
  beforeEach(() => {
    mockError.mockClear();
  });

  it('GET /ping returns 200 with the handler object body', async () => {
    const app = createApp([() => new PingController()]);
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pong: true });
    await app.close();
  });

  it('POST /ping/create returns 200 with the handler object body', async () => {
    const app = createApp([() => new PingController()]);
    const res = await app.inject({ method: 'POST', url: '/ping/create' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: true });
    await app.close();
  });

  it("subpath '/' maps to the base path without a double slash", async () => {
    const app = createApp([() => new PingController()]);
    expect(app.hasRoute({ method: 'GET', url: '/ping' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/ping/' })).toBe(false);
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pong: true });
    await app.close();
  });

  it('derives a kebab-case path from the class name when @controller is missing', async () => {
    const app = createApp([() => new FooBarController()]);
    expect(app.hasRoute({ method: 'GET', url: '/foo-bar' })).toBe(true);
    const res = await app.inject({ method: 'GET', url: '/foo-bar' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('handler throwing synchronously returns 500 with HttpError shape and app keeps working', async () => {
    const app = createApp([() => new BoomController()]);
    const res = await app.inject({ method: 'GET', url: '/boom/sync' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('sync boom');
    expect(mockError).toHaveBeenCalledWith('sync boom', expect.anything());
    // app did not crash: a follow-up request is still answered
    const again = await app.inject({ method: 'GET', url: '/boom/sync' });
    expect(again.statusCode).toBe(500);
    await app.close();
  });

  it('handler returning a rejecting Promise returns 500 with HttpError shape', async () => {
    const app = createApp([() => new BoomController()]);
    const res = await app.inject({ method: 'GET', url: '/boom/rejecting' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('async boom');
    expect(mockError).toHaveBeenCalledWith('async boom', expect.anything());
    await app.close();
  });
});
