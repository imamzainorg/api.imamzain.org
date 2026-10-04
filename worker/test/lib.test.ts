import { sign } from 'hono/jwt';
import { describe, expect, it, vi } from 'vitest';
import { z } from '@hono/zod-openapi';
import { stripSensitive } from '../src/lib/audit';
import { createApp } from '../src/lib/create-app';
import { defineRoute } from '../src/lib/define-route';
import { envelope } from '../src/lib/envelope';
import { conflict } from '../src/lib/errors';
import { envelopeEtag } from '../src/lib/etag';
import { parseAcceptLanguage, resolveTranslation } from '../src/lib/i18n';
import { buildPaginationMeta, paginationShape, resolvePagination } from '../src/lib/pagination';
import type { AppBindings } from '../src/lib/types';

const SECRET = 'test-only-secret-not-for-production-0123456789';
const allow = { limit: async () => ({ success: true }) };

function makeEnv(over: Record<string, unknown> = {}) {
  return {
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: 'https://imamzain.org',
    RL_GLOBAL: allow,
    RL_60: allow,
    RL_30: allow,
    RL_10: allow,
    RL_5: allow,
    RL_VIEW: allow,
    ...over,
  } as unknown as AppBindings;
}

type FakeUser = { id: string; username: string; token_version: number; deleted_at: Date | null; must_change_password: boolean };
const user = (over: Partial<FakeUser> = {}): FakeUser => ({
  id: '11111111-1111-1111-1111-111111111111',
  username: 'admin',
  token_version: 1,
  deleted_at: null,
  must_change_password: false,
  ...over,
});

/** A ported router with a fake DB, plus a few probe routes. */
function testApp(row: FakeUser | null = user()) {
  const app = createApp();
  app.use('*', async (c, next) => {
    c.set('db', { users: { findUnique: async () => row }, $disconnect: async () => {} } as never);
    await next();
  });
  defineRoute(app, { method: 'get', path: '/open', query: z.strictObject(paginationShape) }, (_c, { query }) => ({
    message: 'ok',
    data: query,
  }));
  defineRoute(app, { method: 'get', path: '/me', auth: true }, (c) => ({ message: 'me', data: c.get('user') }));
  defineRoute(app, { method: 'post', path: '/posts', auth: ['posts:create'], body: z.strictObject({ title: z.string().min(1) }) }, () => ({
    message: 'created',
    data: null,
  }));
  defineRoute(app, { method: 'get', path: '/dup' }, () => {
    throw conflict('nope', { code: 'X' });
  });
  defineRoute(app, { method: 'get', path: '/boom' }, () => {
    throw Object.assign(new Error('P2002'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
  });
  return app;
}

const token = (over: Record<string, unknown> = {}) =>
  sign({ sub: user().id, username: 'admin', permissions: ['posts:create'], token_version: 1, exp: Math.floor(Date.now() / 1000) + 600, ...over }, SECRET, 'HS256');

describe('envelope + etag', () => {
  it('appends success and timestamp last, like ResponseInterceptor', () => {
    expect(Object.keys(envelope({ message: 'm', data: 1 }))).toEqual(['message', 'data', 'success', 'timestamp']);
    expect(Object.keys(envelope([1]))).toEqual(['data', 'success', 'timestamp']);
  });

  it('hashes the body without the timestamp', async () => {
    const a = await envelopeEtag('{"data":1,"success":true,"timestamp":"2026-01-01T00:00:00.000Z"}');
    const b = await envelopeEtag('{"data":1,"success":true,"timestamp":"2026-02-02T00:00:00.000Z"}');
    expect(a).toBe(b);
    expect(a).toMatch(/^W\/"[\w-]+"$/);
  });

  it('answers a matching If-None-Match with 304', async () => {
    const app = testApp();
    const first = await app.request('/open', {}, makeEnv());
    const tag = first.headers.get('etag')!;
    expect(tag).toBeTruthy();
    const second = await app.request('/open', { headers: { 'if-none-match': tag } }, makeEnv());
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('content-length')).toBeNull();
    expect(second.headers.get('content-type')).toBeNull();
  });
});

describe('errors', () => {
  it('maps ApiError with its code, no-store and the error envelope', async () => {
    const res = await testApp().request('/dup?a=1', {}, makeEnv());
    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ success: false, code: 'X', error: 'nope', path: '/dup?a=1' });
  });

  it('maps Prisma P2002 to 409', async () => {
    const res = await testApp().request('/boom', {}, makeEnv());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CONFLICT', error: 'A record with that value already exists' });
  });

  it('maps an unknown error to a 500 without leaking it', async () => {
    const app = createApp();
    app.get('/x', () => {
      throw new Error('secret detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('/x', {}, makeEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'INTERNAL_ERROR', error: 'Internal server error' });
  });
});

describe('validation hook', () => {
  it('answers 400 with Nest-style messages', async () => {
    const res = await testApp().request('/open?page=0&limit=500&extra=1', {}, makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string; errors: string[] };
    expect(body).toMatchObject({ code: 'VALIDATION_FAILED', error: 'Validation failed' });
    expect(body.errors).toEqual(
      expect.arrayContaining([
        'page must not be less than 1',
        'limit must not be greater than 100',
        'property extra should not exist',
      ]),
    );
  });

  it('coerces and defaults query values', async () => {
    const res = await testApp().request('/open?page=2', {}, makeEnv());
    expect(await res.json()).toMatchObject({ data: { page: 2, limit: 20 } });
  });

  it('rejects a body with a missing field', async () => {
    const res = await testApp().request(
      '/posts',
      { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: '{}' },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual(['title must be a string']);
  });
});

describe('auth', () => {
  const get = async (t?: string, row?: FakeUser | null, env = makeEnv()) =>
    testApp(row).request('/me', { headers: t ? { authorization: `Bearer ${t}` } : {} }, env);

  it('401 without a token, with a bad one, and with an expired one', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('garbage')).status).toBe(401);
    expect((await get(await token({ exp: Math.floor(Date.now() / 1000) - 10 }))).status).toBe(401);
    expect(await (await get()).json()).toMatchObject({ code: 'UNAUTHORIZED', error: 'Unauthorized' });
  });

  it('401 for a soft-deleted user, a missing user and a stale token_version', async () => {
    expect((await get(await token(), user({ deleted_at: new Date() }))).status).toBe(401);
    expect((await get(await token(), null)).status).toBe(401);
    const stale = await get(await token(), user({ token_version: 2 }));
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ error: 'Token has been invalidated' });
  });

  it('sets the current user on success', async () => {
    const res = await get(await token());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { id: user().id, username: 'admin', permissions: ['posts:create'] } });
  });

  it('403 when a permission is missing', async () => {
    const res = await testApp().request(
      '/posts',
      { method: 'POST', headers: { authorization: `Bearer ${await token({ permissions: [] })}`, 'content-type': 'application/json' }, body: '{"title":"t"}' },
      makeEnv(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'You do not have permission to access this resource' });
  });

  it('must_change_password is only enforced when the flag is on, and /auth/me is exempt', async () => {
    const flagged = user({ must_change_password: true });
    expect((await get(await token(), flagged)).status).toBe(200);
    const res = await get(await token(), flagged, makeEnv({ ENFORCE_PASSWORD_CHANGE_AFTER_RESET: 'true' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });
});

describe('rate limit', () => {
  it('429 with Nest message and code when the binding says no', async () => {
    const res = await testApp().request('/open', {}, makeEnv({ RL_GLOBAL: { limit: async () => ({ success: false }) } }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after-global')).toBe('60');
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED', error: 'ThrottlerException: Too Many Requests' });
  });

  it('keys the global bucket on the client IP', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    await testApp().request('/open', { headers: { 'cf-connecting-ip': '198.51.100.7' } }, makeEnv({ RL_GLOBAL: { limit } }));
    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.7' });
  });
});

describe('cors + secure headers', () => {
  it('echoes only listed origins, with credentials', async () => {
    const ok = await testApp().request('/open', { headers: { origin: 'https://imamzain.org' } }, makeEnv());
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://imamzain.org');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const no = await testApp().request('/open', { headers: { origin: 'https://evil.test' } }, makeEnv());
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
    expect(no.headers.get('vary')).toContain('Origin');
  });

  it('answers preflight 200 and reflects the requested headers', async () => {
    const res = await testApp().request(
      '/open',
      { method: 'OPTIONS', headers: { origin: 'https://imamzain.org', 'access-control-request-headers': 'authorization,content-type' } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization,content-type');
  });

  it('sets the helmet headers', async () => {
    const res = await testApp().request('/open', {}, makeEnv());
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self' https://cdn.jsdelivr.net");
  });
});

describe('i18n, pagination, audit helpers', () => {
  it('parses Accept-Language like the Nest middleware', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(parseAcceptLanguage('AR')).toBe('ar');
    expect(parseAcceptLanguage('*')).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
  });

  it('resolves requested → is_default → ar → lowest code', () => {
    const t = [{ lang: 'en' }, { lang: 'fa', is_default: true }, { lang: 'ar' }];
    expect(resolveTranslation(t, 'en')?.lang).toBe('en');
    expect(resolveTranslation(t, 'de')?.lang).toBe('fa');
    expect(resolveTranslation([{ lang: 'fa' }, { lang: 'ar' }], null)?.lang).toBe('ar');
    expect(resolveTranslation([{ lang: 'fa' }, { lang: 'en' }], null)?.lang).toBe('en');
    expect(resolveTranslation(t, 'en', { active: new Set(['ar']) })?.lang).toBe('ar');
    expect(resolveTranslation(t, 'en', { active: new Set(['ar']), includeInactive: true })?.lang).toBe('en');
  });

  it('clamps pagination', () => {
    expect(resolvePagination({ page: 0, limit: 999 })).toEqual({ page: 1, limit: 100, skip: 0 });
    expect(resolvePagination({ page: 3, limit: 10 }).skip).toBe(20);
    expect(buildPaginationMeta(1, 20, 41)).toEqual({ page: 1, limit: 20, total: 41, pages: 3 });
  });

  it('strips secrets from audit changes recursively', () => {
    expect(stripSensitive({ a: 1, password: 'x', nested: [{ Token: 't', ok: true }] })).toEqual({ a: 1, nested: [{ ok: true }] });
  });
});
