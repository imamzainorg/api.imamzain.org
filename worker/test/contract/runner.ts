import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_JWT_SECRET, LOG_DIR, WORKER_DIR, rel } from '../harness/config';
import { baseEnv, run } from '../harness/proc';

export interface ContractResult {
  ok: boolean;
  /** `7 passed` / `1 failed, 6 passed` */
  summary: string;
  failures: string[];
  log: string;
}

/** Runs the contract suite (one group's file, or all) against `baseUrl`, whose DB is `db`. Full output goes to the log. */
export async function runContract(target: string, baseUrl: string, db: string, group?: string): Promise<ContractResult> {
  const log = path.join(LOG_DIR, `contract-${target}.log`);
  const json = path.join(LOG_DIR, `contract-${target}.json`);
  const files: string[] = [];
  if (group) {
    const file = `test/contract/${group}.test.ts`;
    if (!fs.existsSync(path.join(WORKER_DIR, file))) return { ok: false, summary: `no ${file}`, failures: [], log };
    files.push(file);
  }
  fs.rmSync(json, { force: true });
  await run(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.contract.config.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${json}`, ...files],
    {
      cwd: WORKER_DIR,
      env: { ...baseEnv(), BASE_URL: baseUrl, DATABASE_URL: db, JWT_SECRET: HARNESS_JWT_SECRET, CONTRACT_IMPL: target, NO_COLOR: '1' },
      allowFail: true,
      logFile: log,
    },
  );
  if (!fs.existsSync(json)) return { ok: false, summary: `vitest crashed → ${rel(log)}`, failures: [], log };
  const report = JSON.parse(fs.readFileSync(json, 'utf8')) as {
    numPassedTests: number;
    numFailedTests: number;
    success: boolean;
    testResults: { assertionResults: { fullName: string; status: string }[]; status: string; message?: string; name: string }[];
  };
  const failures = report.testResults.flatMap((f) => [
    ...(f.status === 'failed' && f.assertionResults.length === 0 ? [`${path.basename(f.name)}: ${f.message ?? 'failed to load'}`] : []),
    ...f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName),
  ]);
  const passed = `${report.numPassedTests} passed`;
  return {
    ok: report.success && failures.length === 0,
    summary: report.numFailedTests ? `${report.numFailedTests} failed, ${passed}` : passed,
    failures,
    log,
  };
}
