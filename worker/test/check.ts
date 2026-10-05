/**
 * `npm run check:<group>`: everything a ported group must pass, one line per check (plan, Phase 4):
 * typecheck, the diff replay, and the group's contract tests against Nest and against the Worker.
 * Full output is in test/.work/logs/; the diff report in test/diff/reports/<group>.md. Exit 1 on any failure.
 *
 * The diff runs first, on fresh DB copies; the contract tests then reuse the same servers (they make
 * their own data, so the replay's writes don't matter to them).
 */
import path from 'node:path';
import { LOG_DIR, WORKER_DIR, rel } from './harness/config';
import { prepareDatabases } from './harness/db';
import { run } from './harness/proc';
import { startStack, type Stack } from './harness/servers';
import { runContract } from './contract/runner';
import { runDiff, summaryLine } from './diff/replay';

const group = process.argv[2];
if (!group) {
  console.error('usage: npm run check -- <group>   (or npm run check:<group>)');
  process.exit(2);
}

let failed = false;
function line(name: string, ok: boolean, detail: string, more: string[] = []) {
  failed ||= !ok;
  console.log(`  ${name.padEnd(16)} ${ok ? 'ok  ' : 'FAIL'}  ${detail}`);
  for (const m of more.slice(0, 5)) console.log(`${' '.repeat(26)}× ${m}`);
}

console.log(`check ${group}`);

const typecheckLog = path.join(LOG_DIR, 'typecheck.log');
const tc = await run('npm run typecheck', [], { cwd: WORKER_DIR, shell: true, allowFail: true, logFile: typecheckLog });
const tsErrors = `${tc.stdout}${tc.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.trim());
line('typecheck', tc.code === 0, tc.code === 0 ? '' : `${tsErrors.length || 'see'} errors → ${rel(typecheckLog)}`, tsErrors);

const runStart = Date.now();
let stack: Stack | undefined;
try {
  const { urls, source } = await prepareDatabases(['diff_a', 'diff_b'], (l) => console.log(`  ${l}`));
  stack = await startStack(urls.diff_a, urls.diff_b);

  try {
    const s = await runDiff(group, stack, urls.diff_a, runStart, source);
    line('diff', s.unexplained === 0, summaryLine(s));
  } catch (err) {
    line('diff', false, (err as Error).message.split('\n')[0]);
  }

  for (const [target, url, db] of [['nest', stack.nest, urls.diff_a], ['worker', stack.worker, urls.diff_b]] as const) {
    const r = await runContract(target, url, db, group);
    line(`contract ${target}`, r.ok, r.ok ? r.summary : `${r.summary} → ${rel(r.log)}`, r.failures);
  }
} catch (err) {
  line('harness', false, (err as Error).message);
} finally {
  await stack?.stop();
}
process.exit(failed ? 1 : 0);
