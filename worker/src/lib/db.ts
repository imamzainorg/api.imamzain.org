import { PrismaPg } from '@prisma/adapter-pg';
import type { Context, MiddlewareHandler } from 'hono';
import { PrismaClient } from '../generated/prisma/client';
import type { AppEnv } from './types';

// One client per request through Hyperdrive (Phase 1 check 2). max: 1 keeps it to one
// Hyperdrive connection; the default pool opens several for parallel relation queries.
export function db(env: Env) {
  const adapter = new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return new PrismaClient({ adapter });
}

/** The request's client; created on first use so routes that never touch the DB cost nothing. */
export function getDb(c: Context<AppEnv>): PrismaClient {
  let client = c.get('db');
  if (!client) {
    client = db(c.env);
    c.set('db', client);
  }
  return client;
}

/** `waitUntil` that is a no-op-safe outside a Worker (unit tests have no execution context). */
export function defer(c: Context<AppEnv>, promise: Promise<unknown>): void {
  const settled = promise.catch((err) => console.warn(`deferred task failed: ${err}`));
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    // no ExecutionContext: the promise still runs, it just isn't kept alive past the response
  }
}

/** Closes the request's pool after the response is sent. */
export const closeDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } finally {
    const client = c.get('db');
    if (client) defer(c, client.$disconnect());
  }
};
