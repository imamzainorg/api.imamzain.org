import { sign } from 'hono/jwt';
import { describe, expect, it, vi } from 'vitest';
import { z } from '@hono/zod-openapi';
import { audit, stripSensitive } from '../src/lib/audit';
import { createApp, JSON_BODY_LIMIT } from '../src/lib/create-app';
import { defineRoute } from '../src/lib/define-route';
import { envelope } from '../src/lib/envelope';
import { conflict } from '../src/lib/errors';
import { envelopeEtag } from '../src/lib/etag';
import { parseAcceptLanguage, resolveTranslation } from '../src/lib/i18n';
import { assertSlugRenameAllowed } from '../src/lib/publish-rules';
import { issueMessages, whitelistFirst } from '../src/lib/validation';
import { buildPaginationMeta, paginationShape, resolvePagination } from '../src/lib/pagination';
import { tierFor } from '../src/lib/rate-limit';
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
    expect(first.headers.get('content-type')).toBe('application/json; charset=utf-8');
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
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
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

describe('review fixes', () => {
  const thrower = (err: Error) => {
    const app = createApp();
    app.get('/x', () => {
      throw err;
    });
    return app.request('/x', {}, makeEnv());
  };

  it('a non-UUID id reaching Postgres is 400 INVALID_IDENTIFIER, even if it contains 23514', async () => {
    const res = await thrower(Object.assign(new Error('invalid input syntax for type uuid: "x23514"'), { name: 'DriverAdapterError' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_IDENTIFIER', error: 'Invalid identifier format' });
  });

  it('a CHECK violation from adapter-pg is 400 with the constraint name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await thrower(new Error('new row for relation "books" violates check constraint "books_part_number_check"'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'CHECK_CONSTRAINT_VIOLATION',
      error: 'The submitted values violate a data rule (books_part_number_check)',
    });
  });

  it('accepts a token whose iat is slightly in the future (clock skew with Render)', async () => {
    const res = await testApp().request('/me', { headers: { authorization: `Bearer ${await token({ iat: Math.floor(Date.now() / 1000) + 5 })}` } }, makeEnv());
    expect(res.status).toBe(200);
  });

  it('closes the pool only after a deferred audit insert has finished', async () => {
    const order: string[] = [];
    const fakeDb = {
      audit_logs: {
        create: async () => {
          await new Promise((r) => setTimeout(r, 20));
          order.push('insert');
        },
      },
      $disconnect: async () => {
        order.push('disconnect');
      },
    };
    const app = createApp();
    app.use('*', async (c, next) => {
      c.set('db', fakeDb as never);
      await next();
    });
    defineRoute(app, { method: 'get', path: '/a' }, (c) => {
      audit(c, { actorId: null, action: 'USER_LOGIN', resourceType: 'user' });
      return null;
    });
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {}, props: {} };
    expect((await app.request('/a', {}, makeEnv(), ctx as never)).status).toBe(200);
    await Promise.all(waits);
    expect(order).toEqual(['insert', 'disconnect']);
  });

  it('maps Nest @Throttle limits onto the 60 s tiers', () => {
    expect(tierFor(10)).toBe('RL_10');
    expect(tierFor(60)).toBe('RL_60');
    expect(tierFor(1000)).toBeNull();
    expect(tierFor(300)).toBeNull();
    expect(() => tierFor(7)).toThrow(/No rate-limit binding/);
  });

  it('a numeric route limit uses the mapped binding, keyed per route and IP', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const app = createApp();
    defineRoute(app, { method: 'get', path: '/t', limit: 10 }, () => null);
    await app.request('/t', { headers: { 'cf-connecting-ip': '198.51.100.7' } }, makeEnv({ RL_10: { limit } }));
    expect(limit).toHaveBeenCalledWith({ key: 'GET:/t:198.51.100.7' });
  });

  it('makes a plain z.object body strict', async () => {
    const app = createApp();
    defineRoute(app, { method: 'post', path: '/s', body: z.object({ t: z.string() }) }, () => null);
    const res = await app.request('/s', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":"a","extra":1}' }, makeEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual(['property extra should not exist']);
  });

  it('an oversized body is 413 before the global throttle answers 429', async () => {
    const big = 'x'.repeat(JSON_BODY_LIMIT + 1);
    const res = await testApp().request(
      '/posts',
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(big.length) }, body: big },
      makeEnv({ RL_GLOBAL: { limit: async () => ({ success: false }) } }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', error: 'request entity too large' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sends credentials and preflight headers whatever the origin, like express cors', async () => {
    const get = await testApp().request('/open', { headers: { origin: 'https://evil.test' } }, makeEnv());
    expect(get.headers.get('access-control-allow-credentials')).toBe('true');
    const pre = await testApp().request('/open', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }, makeEnv());
    expect(pre.status).toBe(200);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
  });

  it('emits the CSP exactly as helmet 8 does', async () => {
    const res = await testApp().request('/open', {}, makeEnv());
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self';script-src 'self' https://cdn.jsdelivr.net;style-src 'self' 'unsafe-inline';img-src 'self' data: https:;connect-src 'self';font-src 'self' https:;object-src 'none';frame-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'self';script-src-attr 'none';upgrade-insecure-requests",
    );
  });
});

describe('@MaxBytes and the slug lock', () => {
  it('maps a maxBytes issue to class-validator text behind the nested path', () => {
    const schema = z.object({ translations: z.array(z.object({ body: z.string().refine((v) => v.length < 3, { params: { maxBytes: 2 } }) })) });
    const result = schema.safeParse({ translations: [{ body: 'abc' }] });
    expect(result.success ? [] : result.error.issues.flatMap(issueMessages)).toEqual(['translations.0.body must be at most 2 bytes (UTF-8)']);
  });

  it('locks the slug of a row that is and stays published, like Nest', () => {
    const rename = (over: Partial<Parameters<typeof assertSlugRenameAllowed>[0]>) =>
      assertSlugRenameAllowed({ resourceLabel: 'static page', currentSlug: 'a', nextSlug: 'b', isPublished: true, willBePublished: true, ...over });
    expect(() => rename({})).toThrow(/slug of a published static page cannot be changed/);
    expect(() => rename({ willBePublished: false })).not.toThrow();
    expect(() => rename({ isPublished: false })).not.toThrow();
    expect(() => rename({ nextSlug: 'a' })).not.toThrow();
    expect(() => rename({ nextSlug: undefined })).not.toThrow();
    expect(() => rename({ currentSlug: null })).not.toThrow();
  });

  it('puts the unknown-key error of an object before the errors of its own properties, as ValidationPipe does', () => {
    const schema = z.object({ slug: z.string().min(3), items: z.array(z.strictObject({ a: z.string().min(2) })) }).strict();
    const result = schema.safeParse({ slug: 'x', extra: 1, items: [{ a: 'y', b: 1 }] });
    const texts = result.success ? [] : whitelistFirst(result.error.issues).flatMap(issueMessages);
    expect(texts).toEqual([
      'property extra should not exist',
      'slug must be longer than or equal to 3 characters',
      'items.0.property b should not exist',
      'items.0.a must be longer than or equal to 2 characters',
    ]);
  });
});

describe('array element messages', () => {
  const messages = (schema: z.ZodType, value: unknown) => {
    const r = schema.safeParse(value);
    return r.success ? [] : r.error.issues.flatMap(issueMessages);
  };

  it('names the array, as class-validator does for { each: true }', () => {
    const schema = z.object({ tags: z.array(z.string().max(3)) });
    expect(messages(schema, { tags: ['abcd'] })).toEqual(['each value in tags must be shorter than or equal to 3 characters']);
    expect(messages(schema, { tags: [5] })).toEqual(['each value in tags must be a string']);
  });

  it('puts the parent path in front of an `each` message, as Nest does', () => {
    const schema = z.object({ items: z.array(z.object({ tags: z.array(z.string().max(3)) })) });
    expect(messages(schema, { items: [{ tags: ['abcd'] }] })).toEqual(['items.0.each value in tags must be shorter than or equal to 3 characters']);
  });

  it('keeps the dotted path for elements that are objects', () => {
    expect(messages(z.object({ items: z.array(z.object({ a: z.string() })) }), { items: [{ a: 1 }] })).toEqual(['items.0.a must be a string']);
  });
});
