import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DUMP_PATH, LOG_DIR, PORTS, WORKER_DIR } from './config';
import { baseEnv, run } from './proc';

/**
 * The diff harness database: Postgres 16 in Docker (same major as CI), holding a scrubbed copy of the
 * prod dump as a template DB. Each run clones the template into fresh copies (A for Nest, B for the
 * Worker), so writes never leak between runs. Only Docker is needed on the host: pg_restore and psql
 * run inside containers.
 */
const CONTAINER = 'imamzain-diff-pg';
const TEMPLATE = 'imamzain_template';
const STAGING = 'imamzain_restore';
const SCRUB_SQL = path.join(WORKER_DIR, 'test/diff/scrub.sql');

export const dbUrl = (name: string) => `postgresql://postgres:postgres@localhost:${PORTS.pg}/${name}`;

const docker = (args: string[], input?: string | Buffer) => run('docker', args, { input });
const psql = (db: string, sql: string) =>
  docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-f', '-'], sql);

async function ensureContainer(): Promise<void> {
  const state = (await run('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], { allowFail: true })).stdout.toString().trim();
  if (state === 'false') await docker(['start', CONTAINER]);
  else if (state !== 'true') {
    await docker(['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-p', `${PORTS.pg}:5432`, 'postgres:16']);
  }
  for (let i = 0; i < 60; i++) {
    if ((await run('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-q'], { allowFail: true })).code === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${CONTAINER} did not become ready`);
}

/** Changes when the dump or scrub.sql does, so either one triggers a rebuild. */
function fingerprint(): string {
  const stat = fs.statSync(DUMP_PATH);
  const scrub = createHash('sha256').update(fs.readFileSync(SCRUB_SQL)).digest('hex').slice(0, 12);
  return `dump:${stat.size}:${Math.floor(stat.mtimeMs)} scrub:${scrub}`;
}

async function templateComment(): Promise<string | null> {
  const out = await psql('postgres', `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${TEMPLATE}'`);
  const rows = out.stdout.toString().trim();
  return rows === '' ? null : rows;
}

/** Applies migrations newer than the dump, so the DB matches the code under test. */
async function migrate(db: string): Promise<void> {
  const url = dbUrl(db);
  await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', '../prisma/schema.prisma'], {
    cwd: WORKER_DIR,
    env: { ...baseEnv(), DATABASE_URL: url, DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    logFile: path.join(LOG_DIR, 'migrate.log'),
  });
}

async function buildTemplate(print: (line: string) => void): Promise<void> {
  if (!fs.existsSync(DUMP_PATH)) {
    throw new Error(`No template DB yet and no dump at ${DUMP_PATH}. Make one (runbook S6) or set DIFF_DUMP.`);
  }
  print(`template: restoring ${DUMP_PATH} and scrubbing PII (first run or dump changed)`);
  await psql('postgres', `DROP DATABASE IF EXISTS ${STAGING} WITH (FORCE); CREATE DATABASE ${STAGING};`);
  // Supabase keeps citext and pg_trgm in public; the dump's public objects reference nothing else.
  await psql(STAGING, 'CREATE EXTENSION citext; CREATE EXTENSION pg_trgm; CREATE EXTENSION pgcrypto;');
  // pg_restore 18 reads any dump version and writes SQL (no server needed). Its one statement PG16
  // doesn't know is `SET transaction_timeout`; dropping it lets psql run with ON_ERROR_STOP.
  const sql = (
    await run('docker', ['run', '-i', '--rm', 'postgres:18', 'pg_restore', '-f', '-', '--no-owner', '--no-privileges', '-n', 'public'], {
      input: fs.readFileSync(DUMP_PATH),
    })
  ).stdout
    .toString()
    .replace(/^SET transaction_timeout = .*$/m, '');
  await docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', STAGING, '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null', '-f', '-'], sql);
  await psql(STAGING, fs.readFileSync(SCRUB_SQL, 'utf8'));
  await migrate(STAGING);
  await psql(
    'postgres',
    `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE);
     ALTER DATABASE ${STAGING} RENAME TO ${TEMPLATE};
     COMMENT ON DATABASE ${TEMPLATE} IS '${fingerprint()}';`,
  );
}

/**
 * Ensures the scrubbed template exists (restoring the dump only when it is missing or the dump/scrub
 * changed) and returns fresh clones named `names`, plus a description of the data for reports.
 */
export async function prepareDatabases(
  names: string[],
  print: (line: string) => void = () => {},
): Promise<{ urls: Record<string, string>; source: string }> {
  await ensureContainer();
  let comment = await templateComment();
  if (comment === null || (fs.existsSync(DUMP_PATH) && comment !== fingerprint())) {
    await buildTemplate(print);
    comment = await templateComment();
  } else await migrate(TEMPLATE);
  const urls: Record<string, string> = {};
  for (const name of names) {
    await psql('postgres', `DROP DATABASE IF EXISTS ${name} WITH (FORCE); CREATE DATABASE ${name} TEMPLATE ${TEMPLATE};`);
    urls[name] = dbUrl(name);
  }
  const mtime = Number(/^dump:\d+:(\d+)/.exec(comment ?? '')?.[1]);
  const date = Number.isFinite(mtime) ? new Date(mtime).toISOString().slice(0, 10) : 'unknown date';
  return { urls, source: `the scrubbed prod dump of ${date}` };
}
