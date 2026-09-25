import 'reflect-metadata';
import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import buildRoutes from './build-routes.js';
import controller from './decorators/controller.js';
import get from './decorators/get.js';
import post from './decorators/post.js';
import { ICreateController } from './types.js';
import HttpError from '../errors/http-error.js';

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

@controller('/http-error')
class HttpErrorController {
  @get('/sync-422')
  sync422() {
    throw new HttpError({ message: 'unprocessable', statusCode: 422 });
  }

  @get('/rejecting-422')
  rejecting422() {
    return Promise.reject(
      new HttpError({ message: 'unprocessable', statusCode: 422 })
    );
  }

  @get('/sync-502')
  sync502() {
    throw new HttpError({ message: 'bad gateway', statusCode: 502 });
  }

  @get('/rejecting-502')
  rejecting502() {
    return Promise.reject(
      new HttpError({ message: 'bad gateway', statusCode: 502 })
    );
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

  it('handler throwing an HttpError (422) synchronously preserves statusCode', async () => {
    const app = createApp([() => new HttpErrorController()]);
    const res = await app.inject({ method: 'GET', url: '/http-error/sync-422' });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.statusCode).toBe(422);
    expect(body.message).toBe('unprocessable');
    expect(mockError).toHaveBeenCalledWith('unprocessable', expect.anything());
    await app.close();
  });

  it('handler rejecting with an HttpError (422) preserves statusCode', async () => {
    const app = createApp([() => new HttpErrorController()]);
    const res = await app.inject({ method: 'GET', url: '/http-error/rejecting-422' });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.statusCode).toBe(422);
    expect(body.message).toBe('unprocessable');
    expect(mockError).toHaveBeenCalledWith('unprocessable', expect.anything());
    await app.close();
  });

  it('handler throwing an HttpError (502) synchronously preserves statusCode', async () => {
    const app = createApp([() => new HttpErrorController()]);
    const res = await app.inject({ method: 'GET', url: '/http-error/sync-502' });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.statusCode).toBe(502);
    expect(body.message).toBe('bad gateway');
    expect(mockError).toHaveBeenCalledWith('bad gateway', expect.anything());
    await app.close();
  });

  it('handler rejecting with an HttpError (502) preserves statusCode', async () => {
    const app = createApp([() => new HttpErrorController()]);
    const res = await app.inject({ method: 'GET', url: '/http-error/rejecting-502' });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.statusCode).toBe(502);
    expect(body.message).toBe('bad gateway');
    expect(mockError).toHaveBeenCalledWith('bad gateway', expect.anything());
    await app.close();
  });
});
