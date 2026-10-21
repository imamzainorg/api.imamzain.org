import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_ALLOWED_ORIGINS, HARNESS_HIJRI_SOURCE_URL, HARNESS_JWT_SECRET, HARNESS_R2, LOG_DIR, PORTS, WORKER_DIR, WORK_DIR, rel } from './config';
import { baseEnv, portInUse, startBackground, stopTree, waitForHttp } from './proc';

export interface Stack {
  /** The Worker's base URL. */
  worker: string;
  stop(): Promise<void>;
}

/** `wrangler dev --local` with a generated env file: `--env-file` also stops wrangler reading worker/.dev.vars. */
async function startWorker(children: ChildProcess[], db: string): Promise<string> {
  const logFile = path.join(LOG_DIR, 'worker.log');
  const envFile = path.join(WORK_DIR, 'worker.env');
  fs.writeFileSync(envFile, [`JWT_SECRET=${HARNESS_JWT_SECRET}`, 'BCRYPT_ROUNDS=4', 'FORM_NOTIFY_MIN_INTERVAL_SECONDS=0', ...Object.entries(HARNESS_R2).map(([k, v]) => `${k}=${v}`), `ALLOWED_ORIGINS=${HARNESS_ALLOWED_ORIGINS}`, `HIJRI_SOURCE_URL=${HARNESS_HIJRI_SOURCE_URL}`, ''].join('\n'));
  const state = path.join(WORK_DIR, 'wrangler-state');
  fs.rmSync(state, { recursive: true, force: true });
  const args = [
    'node_modules/wrangler/bin/wrangler.js', 'dev', '--local',
    '--ip', '127.0.0.1', '--port', String(PORTS.worker),
    '--env-file', envFile, '--persist-to', state,
    '--show-interactive-dev-session=false', '--log-level', 'warn',
    // /__scheduled?cron=... fires a Cron Trigger (test/contract/jobs.test.ts).
    '--test-scheduled',
  ];
  const child = startBackground(process.execPath, args, {
    cwd: WORKER_DIR,
    logFile,
    env: {
      ...baseEnv(),
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: db,
      WRANGLER_SEND_METRICS: 'false',
    },
  });
  children.push(child);
  const url = `http://127.0.0.1:${PORTS.worker}`;
  await waitForHttp(`${url}/api/v1/health`, child, logFile);
  return url;
}

/** The Worker on `db`, under `wrangler dev --local`. */
export async function startStack(db: string): Promise<Stack> {
  if (await portInUse(PORTS.worker)) throw new Error(`port ${PORTS.worker} is in use; stop whatever runs there (a previous harness run?)`);
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const children: ChildProcess[] = [];
  const stop = async () => {
    await Promise.all(children.map(stopTree));
  };
  try {
    return { worker: await startWorker(children, db), stop };
  } catch (err) {
    await stop();
    throw new Error(`${(err as Error).message}
(logs in ${rel(LOG_DIR)})`);
  }
}
