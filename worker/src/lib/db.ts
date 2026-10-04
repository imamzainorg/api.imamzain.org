import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// One client per request through Hyperdrive (Phase 1 check 2). max: 1 keeps it to one
// Hyperdrive connection; the default pool opens several for parallel relation queries.
export function db(env: Env) {
  const adapter = new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return new PrismaClient({ adapter });
}
