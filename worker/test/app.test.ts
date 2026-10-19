import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { createApp } from '../src/lib/create-app';
import { defineRoute } from '../src/lib/define-route';
import { errorHandler, notFound } from '../src/lib/errors';
import type { AppEnv } from '../src/lib/types';

const env = {} as unknown as Env;

describe('unknown route', () => {
  it('answers 404 in the error envelope, with Nest\'s text', async () => {
    const res = await app.request('/api/v1/not-a-route?x=1', {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      error: 'Cannot GET /api/v1/not-a-route',
      path: '/api/v1/not-a-route?x=1',
    });
  });
});

describe('group router', () => {
  const limit = vi.fn(async () => ({ success: true }));
  const groupEnv = { ALLOWED_ORIGINS: 'https://imamzain.org', RL_GLOBAL: { limit } } as unknown as Env;

  function withGroup() {
    const group = createApp();
    defineRoute(group, { method: 'get', path: '/' }, () => ({ message: 'ok', data: 1 }));
    const a = new Hono<AppEnv>();
    a.route('/api/v1/g', group);
    a.notFound((c) => errorHandler(notFound(), c));
    return a;
  }

  it('serves its routes with the shared middleware', async () => {
    limit.mockClear();
    const res = await withGroup().request('/api/v1/g', {}, groupEnv);
    expect(await res.json()).toMatchObject({ message: 'ok', data: 1, success: true });
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it('404s an unmatched path under the prefix without group middleware', async () => {
    limit.mockClear();
    const res = await withGroup().request('/api/v1/g/nope', {}, groupEnv);
    expect(res.status).toBe(404);
    expect(limit).not.toHaveBeenCalled();
  });

  it('answers preflights itself', async () => {
    const res = await withGroup().request('/api/v1/g/anything', { method: 'OPTIONS', headers: { origin: 'https://imamzain.org' } }, groupEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://imamzain.org');
  });
});
