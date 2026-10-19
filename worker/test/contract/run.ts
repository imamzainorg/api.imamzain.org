/**
 * `npm run contract [-- <group>]`: starts the Worker (`wrangler dev --local`) on a migrated and seeded
 * Postgres and runs the contract suite against it. The DB is CONTRACT_DATABASE_URL, default the local
 * test database from the Worker's wrangler.jsonc (`npm run prisma:deploy && npm run prisma:seed` at the repo root).
 */
import { rel } from '../harness/config';
import { startStack } from '../harness/servers';
import { runContract } from './runner';

const DEFAULT_DB = 'postgresql://postgres:postgres@localhost:5432/imamzain_test';

async function main(group: string | undefined): Promise<boolean> {
  const db = process.env.CONTRACT_DATABASE_URL ?? DEFAULT_DB;
  const stack = await startStack(db);
  try {
    const r = await runContract(stack.worker, db, group);
    console.log(`contract: ${r.summary}${r.ok ? '' : ` → ${rel(r.log)}`}`);
    for (const f of r.failures.slice(0, 10)) console.log(`  × ${f}`);
    return r.ok;
  } finally {
    await stack.stop();
  }
}

main(process.argv[2]).then(
  (ok) => process.exit(ok ? 0 : 1),
  (err: Error) => {
    console.error(`contract: ${err.message}`);
    process.exit(1);
  },
);
