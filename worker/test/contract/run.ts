/**
 * `npm run contract [-- <group>]`: starts Nest and the Worker (whose fallthrough origin is that Nest)
 * on one DB and runs the contract suite once per target. The DB is CONTRACT_DATABASE_URL when set (CI:
 * migrated and seeded), else a fresh clone of the diff harness template (Docker).
 */
import { rel } from '../harness/config';
import { prepareDatabases } from '../harness/db';
import { startStack } from '../harness/servers';
import { runContract } from './runner';

const group = process.argv[2];
const db = process.env.CONTRACT_DATABASE_URL ?? (await prepareDatabases(['contract'], console.log)).urls.contract;
const stack = await startStack(db);
let failed = false;
try {
  for (const [target, url] of [['nest', stack.nest], ['worker', stack.worker]] as const) {
    const r = await runContract(target, url, db, group);
    failed ||= !r.ok;
    console.log(`contract ${target}: ${r.summary}${r.ok ? '' : ` → ${rel(r.log)}`}`);
    for (const f of r.failures.slice(0, 10)) console.log(`  × ${f}`);
  }
} finally {
  await stack.stop();
}
process.exit(failed ? 1 : 0);
