import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_ALLOWED_ORIGINS, HARNESS_JWT_SECRET, LOG_DIR, PORTS, REPO_DIR, WORK_DIR, WORKER_DIR, rel } from './config';
import { baseEnv, portInUse, run, startBackground, stopTree, waitForHttp } from './proc';

export interface Stack {
  /** Nest on DB A: the reference. */
  nest: string;
  /** The Worker; anything it hasn't ported falls through to its own Nest (on DB B when given). */
  worker: string;
  stop(): Promise<void>;
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) newest = Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}

/** Builds Nest (`npm run build` at the repo root) when dist/ is missing or older than src/ or the schema. */
export async function ensureNestBuild(): Promise<void> {
  const main = path.join(REPO_DIR, 'dist/src/main.js');
  const built = fs.existsSync(main) ? fs.statSync(main).mtimeMs : 0;
  const sources = Math.max(newestMtime(path.join(REPO_DIR, 'src')), fs.statSync(path.join(REPO_DIR, 'prisma/schema.prisma')).mtimeMs);
  if (built > sources) return;
  await run('npm run build', [], { cwd: REPO_DIR, shell: true, logFile: path.join(LOG_DIR, 'nest-build.log') });
}

/**
 * Nest with only what it needs. Its cwd is test/.work, so the repo's real .env (R2, SMTP and Twilio
 * keys) is never loaded: nothing a scenario does can send mail, upload to R2 or text anyone.
 */
async function startNest(children: ChildProcess[], name: string, port: number, db: string): Promise<string> {
  const logFile = path.join(LOG_DIR, `${name}.log`);
  const child = startBackground(process.execPath, [path.join(REPO_DIR, 'dist/src/main.js')], {
    cwd: WORK_DIR,
    logFile,
    env: {
      ...baseEnv(),
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: db,
      DIRECT_URL: db,
      JWT_SECRET: HARNESS_JWT_SECRET,
      ALLOWED_ORIGINS: HARNESS_ALLOWED_ORIGINS,
      DISABLE_CRON: 'true',
      EXPOSE_DOCS: 'true',
      LOG_LEVEL: 'warn',
    },
  });
  children.push(child);
  const url = `http://127.0.0.1:${port}`;
  await waitForHttp(`${url}/api/v1/health`, child, logFile);
  return url;
}

/** `wrangler dev --local` with a generated env file: `--env-file` also stops wrangler reading worker/.dev.vars. */
async function startWorker(children: ChildProcess[], origin: string, db: string): Promise<string> {
  const logFile = path.join(LOG_DIR, 'worker.log');
  const envFile = path.join(WORK_DIR, 'worker.env');
  fs.writeFileSync(envFile, [`JWT_SECRET=${HARNESS_JWT_SECRET}`, `ORIGIN_URL=${origin}`, `ALLOWED_ORIGINS=${HARNESS_ALLOWED_ORIGINS}`, ''].join('\n'));
  const state = path.join(WORK_DIR, 'wrangler-state');
  fs.rmSync(state, { recursive: true, force: true });
  const args = [
    'node_modules/wrangler/bin/wrangler.js', 'dev', '--local',
    '--ip', '127.0.0.1', '--port', String(PORTS.worker),
    '--env-file', envFile, '--persist-to', state,
    '--show-interactive-dev-session=false', '--log-level', 'warn',
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

/**
 * The strangler layout: Nest on `dbA`, and the Worker on `dbB` whose fallthrough origin is a second
 * Nest on `dbB`, so a ported route and an unported one see the same data. Without `dbB` (CI), one Nest
 * and the Worker share `dbA`.
 */
export async function startStack(dbA: string, dbB?: string): Promise<Stack> {
  const ports = dbB ? [PORTS.nestA, PORTS.nestB, PORTS.worker] : [PORTS.nestA, PORTS.worker];
  for (const port of ports) {
    if (await portInUse(port)) throw new Error(`port ${port} is in use; stop whatever runs there (a previous harness run?)`);
  }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  await ensureNestBuild();
  const children: ChildProcess[] = [];
  const stop = async () => {
    await Promise.all(children.map(stopTree));
  };
  try {
    const nest = await startNest(children, 'nest-a', PORTS.nestA, dbA);
    const origin = dbB ? await startNest(children, 'nest-b', PORTS.nestB, dbB) : nest;
    const worker = await startWorker(children, origin, dbB ?? dbA);
    return { nest, worker, stop };
  } catch (err) {
    await stop();
    throw new Error(`${(err as Error).message}\n(logs in ${rel(LOG_DIR)})`);
  }
}
