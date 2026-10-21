import { sign } from 'hono/jwt';
import { describe, expect, it, vi } from 'vitest';
import { z } from '@hono/zod-openapi';
import { audit, stripSensitive } from '../src/lib/audit';
import { createApp, JSON_BODY_LIMIT } from '../src/lib/create-app';
import { defineRoute } from '../src/lib/define-route';
import { issueMessages, whitelistFirst } from '../src/lib/validation';
import type { AppBindings } from '../src/lib/types';

// What the contract suite can't reach over HTTP: env flags, thrown errors, clock skew and deferred work.

const SECRET = 'test-only-secret-not-for-production-0123456789';
const allow = { limit: async () => ({ success: true }) };

function makeEnv(over: Record<string, unknown> = {}) {
  return {
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: 'https://imamzain.org',
    RL_GLOBAL: allow,
    RL_120: allow,
    RL_60: allow,
    RL_30: allow,
    RL_20: allow,
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
  defineRoute(app, { method: 'get', path: '/me', auth: true }, (c) => ({ message: 'me', data: c.get('user') }));
  defineRoute(app, { method: 'post', path: '/posts', auth: ['posts:create'], body: z.strictObject({ title: z.string().min(1) }) }, () => ({
    message: 'created',
    data: null,
  }));
  return app;
}

const token = (over: Record<string, unknown> = {}) =>
  sign({ sub: user().id, username: 'admin', permissions: ['posts:create'], token_version: 1, exp: Math.floor(Date.now() / 1000) + 600, ...over }, SECRET, 'HS256');

const thrower = (err: Error) => {
  const app = createApp();
  app.get('/x', () => {
    throw err;
  });
  return app.request('/x', {}, makeEnv());
};

describe('errors', () => {
  it('maps an unknown error to a 500 without leaking it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await thrower(new Error('secret detail'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'INTERNAL_ERROR', error: 'Internal server error' });
  });

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
});

describe('auth', () => {
  it('must_change_password is only enforced when the flag is on', async () => {
    const flagged = user({ must_change_password: true });
    const get = async (env: AppBindings) => testApp(flagged).request('/me', { headers: { authorization: `Bearer ${await token()}` } }, env);
    expect((await get(makeEnv())).status).toBe(200);
    const res = await get(makeEnv({ ENFORCE_PASSWORD_CHANGE_AFTER_RESET: 'true' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('accepts a token whose iat is slightly in the future (clock skew with Render)', async () => {
    const res = await testApp().request('/me', { headers: { authorization: `Bearer ${await token({ iat: Math.floor(Date.now() / 1000) + 5 })}` } }, makeEnv());
    expect(res.status).toBe(200);
  });
});

describe('request pipeline', () => {
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

  it('strips secrets from audit changes recursively', () => {
    expect(stripSensitive({ a: 1, password: 'x', nested: [{ Token: 't', ok: true }] })).toEqual({ a: 1, nested: [{ ok: true }] });
  });

  it('puts the unknown-key error of a nested object before the errors of its own properties, as ValidationPipe does', () => {
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
