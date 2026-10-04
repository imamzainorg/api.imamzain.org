import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';

const env = { ORIGIN_URL: 'https://origin.test' } as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

describe('fallthrough', () => {
  it('forwards to ORIGIN_URL with X-Forwarded-For from CF-Connecting-IP', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => new Response('from origin', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(
      '/api/v1/health?x=1',
      { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' } },
      env,
    );

    expect(res.status).toBe(202);
    expect(await res.text()).toBe('from origin');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://origin.test/api/v1/health?x=1');
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
