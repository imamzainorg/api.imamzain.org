import { PrismaPg } from '@prisma/adapter-pg';
import type { Context, MiddlewareHandler } from 'hono';
import { PrismaClient, type Prisma } from '../generated/prisma/client';
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

/**
 * Serializes writers of the same `key` until the transaction ends. For a check-then-write the database
 * can't enforce, e.g. case-insensitive name uniqueness over a case-sensitive unique index.
 */
export async function lockKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** `waitUntil`, safe outside a Worker (unit tests have no execution context: the promise still runs). */
function keepAlive(c: Context<AppEnv>, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // no ExecutionContext
  }
}

/** Work that finishes after the response (audit rows). A failure is logged, never thrown. */
export function defer(c: Context<AppEnv>, promise: Promise<unknown>): void {
  const settled = promise.catch((err) => console.warn(`deferred task failed: ${err}`));
  const list = c.get('deferred');
  if (list) list.push(settled);
  else c.set('deferred', [settled]);
  keepAlive(c, settled);
}

/**
 * Closes the request's pool once the response is sent AND every deferred task has settled: a closing
 * pg pool refuses new queries, so disconnecting first would drop an audit insert still waiting for
 * the connection.
 */
export const closeDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } finally {
    const client = c.get('db');
    if (client) {
      const pending = c.get('deferred') ?? [];
      keepAlive(
        c,
        Promise.allSettled(pending)
          .then(() => client.$disconnect())
          .catch((err) => console.warn(`$disconnect failed: ${err}`)),
      );
    }
  }
};
