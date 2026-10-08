import type { Context } from 'hono';
import { getDb } from '../../lib/db';
import type { AppEnv } from '../../lib/types';

// A health check that can hang defeats its purpose: bound each probe so a dead dependency reads DEGRADED.
const HEALTH_CHECK_TIMEOUT_MS = 2_500;

type Status = 'healthy' | 'unhealthy';

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout);
      },
    );
  });
}

export async function check(c: Context<AppEnv>) {
  const probe = (p: Promise<unknown>): Promise<Status> =>
    withTimeout(p.then(() => 'healthy' as const, () => 'unhealthy' as const), HEALTH_CHECK_TIMEOUT_MS, 'unhealthy');
  const [database, storage] = await Promise.all([
    probe(getDb(c).$queryRaw`SELECT 1`),
    probe(c.env.R2.list({ limit: 1 })),
  ]);

  const now = new Date().toISOString();
  return {
    message: 'Health check',
    status: database === 'healthy' && storage === 'healthy' ? 'OK' : 'DEGRADED',
    database: { status: database, timestamp: now },
    storage: { status: storage, timestamp: now },
    version: '1.0.0',
  };
}
