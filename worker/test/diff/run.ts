/**
 * `npm run diff -- <group> [<group>...]`: fresh DB copies from the scrubbed template, Nest + the Worker,
 * the replay, one console line per group. Exit 1 when any diff is unexplained. Full reports:
 * test/diff/reports/<group>.md; server logs: test/.work/logs/.
 */
import { prepareDatabases } from '../harness/db';
import { startStack } from '../harness/servers';
import { runDiff, summaryLine } from './replay';

const groups = process.argv.slice(2);
if (groups.length === 0) {
  console.error('usage: npm run diff -- <group> [<group>...]');
  process.exit(2);
}

const runStart = Date.now();
const { urls, source } = await prepareDatabases(['diff_a', 'diff_b'], console.log);
const stack = await startStack(urls.diff_a, urls.diff_b);
let failed = false;
try {
  for (const group of groups) {
    const s = await runDiff(group, stack, urls.diff_a, runStart, source);
    failed ||= s.unexplained > 0;
    console.log(`diff ${group}: ${summaryLine(s)}`);
  }
} finally {
  await stack.stop();
}
process.exit(failed ? 1 : 0);
