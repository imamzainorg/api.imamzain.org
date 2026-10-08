import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { createApp } from '../src/lib/create-app';
import { defineRoute } from '../src/lib/define-route';
import { proxyToOrigin } from '../src/lib/proxy';
import type { AppEnv } from '../src/lib/types';

const env = { ORIGIN_URL: 'https://origin.test' } as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

describe('fallthrough', () => {
  it('forwards to ORIGIN_URL with X-Forwarded-For from CF-Connecting-IP', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => new Response('from origin', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(
      '/api/v1/users?x=1',
      { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' } },
      env,
    );

    expect(res.status).toBe(202);
    expect(await res.text()).toBe('from origin');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://origin.test/api/v1/users?x=1');
    expect((init.headers as Headers).get('x-forwarded-for')).toBe('203.0.113.9');
  });

  it('passes method and body through', async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => new Response(await new Response(init.body).text()));
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/api/v1/forms/contact', { method: 'POST', body: '{"a":1}' }, env);

    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(await res.text()).toBe('{"a":1}');
  });
});

describe('ported prefix', () => {
  const limit = vi.fn(async () => ({ success: true }));
  const groupEnv = { ...env, ALLOWED_ORIGINS: 'https://imamzain.org', RL_GLOBAL: { limit } } as unknown as Env;

  function withGroup() {
    const group = createApp();
    defineRoute(group, { method: 'get', path: '/' }, () => ({ message: 'ok', data: 1 }));
    const a = new Hono<AppEnv>();
    a.route('/api/v1/g', group);
    a.all('*', proxyToOrigin);
    return a;
  }

  it('serves its routes with the shared middleware', async () => {
    limit.mockClear();
    const res = await withGroup().request('/api/v1/g', {}, groupEnv);
    expect(await res.json()).toMatchObject({ message: 'ok', data: 1, success: true });
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it('proxies an unmatched path without wrapping the reply in group middleware', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { vary: 'Origin' } })));
    limit.mockClear();
    const res = await withGroup().request('/api/v1/g/not-ported', { headers: { origin: 'https://imamzain.org' } }, groupEnv);
    expect(res.headers.get('vary')).toBe('Origin');
    expect(res.headers.get('etag')).toBeNull();
    expect(limit).not.toHaveBeenCalled();
  });

  it('answers preflights itself', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await withGroup().request('/api/v1/g/anything', { method: 'OPTIONS', headers: { origin: 'https://imamzain.org' } }, groupEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://imamzain.org');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fallthrough log', () => {
  it('logs each fallthrough as `fallthrough`, path only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await app.request('/api/v1/whatsapp?token=secret', {}, env);
    expect(log).toHaveBeenCalledWith({ event: 'fallthrough', method: 'GET', path: '/api/v1/whatsapp' });
    log.mockRestore();
  });
});
