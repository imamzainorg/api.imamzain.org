import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Logs, env files and wrangler state. Gitignored; safe to delete. */
export const WORK_DIR = path.join(WORKER_DIR, 'test/.work');
export const LOG_DIR = path.join(WORK_DIR, 'logs');

/**
 * The Worker's port; not a default one, so a running `npm run dev` doesn't clash. CONTRACT_PORT overrides it,
 * e.g. on Windows hosts where Hyper-V reserves a range around 8797 (`netsh interface ipv4 show excludedportrange`).
 */
export const PORTS = { worker: Number(process.env.CONTRACT_PORT ?? 8797) } as const;

/** Signs harness and contract tokens. Never a real secret: it only exists in local and CI stacks. */
export const HARNESS_JWT_SECRET = 'harness-only-jwt-secret-not-for-production-0000';

/** The mobile app's key for the harness stack (X-App-Key). Never a real secret. */
export const HARNESS_APP_KEY = 'harness-only-app-key-not-for-production';

/** Fake R2 credentials: presigning is pure computation, and the Worker's storage calls go to wrangler's local bucket. */
export const HARNESS_R2 = { R2_ACCOUNT_ID: 'harness-account', R2_ACCESS_KEY_ID: 'harness-key', R2_SECRET_ACCESS_KEY: 'harness-secret' };

/** Nothing listens here: the suite never reads sistani.org, so the Hijri date starts from Umm al-Qura. */
export const HARNESS_HIJRI_SOURCE_URL = 'http://127.0.0.1:9/';

/** The production list (worker/wrangler.jsonc), so CORS behaves as in prod. */
export const HARNESS_ALLOWED_ORIGINS = 'https://imamzain.org,https://cms.imamzain.com,https://app.imamzain.org';

export const rel = (p: string) => path.relative(WORKER_DIR, p).replaceAll('\\', '/');
