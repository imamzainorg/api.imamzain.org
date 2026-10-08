import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO_DIR = path.dirname(WORKER_DIR);
/** Logs, env files, wrangler state and Nest's cwd. Gitignored; safe to delete. */
export const WORK_DIR = path.join(WORKER_DIR, 'test/.work');
export const LOG_DIR = path.join(WORK_DIR, 'logs');

/** Ports for the local stack; none of them is a default port, so a running `npm run dev` doesn't clash. */
export const PORTS = { pg: 55432, nestA: 3101, nestB: 3102, worker: 8797 } as const;

/** Signs harness and contract tokens on both targets. Never a real secret: it only exists in local and CI stacks. */
export const HARNESS_JWT_SECRET = 'harness-only-jwt-secret-not-for-production-0000';

/** The production list (worker/wrangler.jsonc), so CORS behaves as in prod on both targets. */
/**
 * Fake R2 credentials for both servers: presigning is pure computation, so upload URLs come out alike;
 * Nest's storage calls fail against an account that doesn't exist, and the Worker's go to its local
 * (simulated) bucket.
 */
export const HARNESS_R2 = { R2_ACCOUNT_ID: 'harness-account', R2_ACCESS_KEY_ID: 'harness-key', R2_SECRET_ACCESS_KEY: 'harness-secret' };

export const HARNESS_ALLOWED_ORIGINS = 'https://imamzain.org,https://cms.imamzain.com,https://app.imamzain.org';

/** Where the prod dump is (runbook S6). Only needed to build the template DB; set DIFF_DUMP to override. */
export const DUMP_PATH = process.env.DIFF_DUMP ?? 'C:\\dumps\\imamzain.dump';

export const rel = (p: string) => path.relative(WORKER_DIR, p).replaceAll('\\', '/');
