import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { WORK_DIR, WORKER_DIR } from '../harness/config';
import { seedPost, uid } from './support/content';
import { BASE_URL, withDb } from './support/http';

/**
 * The Phase 5 cron jobs, fired through `wrangler dev --test-scheduled`. 
 */
async function fire(cron: string) {
  const res = await fetch(`${BASE_URL}/__scheduled?cron=${encodeURIComponent(cron)}`);
  expect(res.status, await res.text()).toBe(200);
}

const run = promisify(execFile);
const wrangler = (...args: string[]) =>
  run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', ...args, '--local', '--persist-to', path.join(WORK_DIR, 'wrangler-state')], { cwd: WORKER_DIR });

async function r2Put(key: string) {
  const file = path.join(os.tmpdir(), `jobs-${uid('f')}`);
  fs.writeFileSync(file, 'orphan');
  try {
    await wrangler('put', `imamzain-media/${key}`, '--file', file, '--content-type', 'image/jpeg');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const r2Exists = (key: string) =>
  wrangler('get', `imamzain-media/${key}`, '--pipe').then(
    () => true,
    () => false,
  );

describe('every minute: scheduled publish', () => {
  it('publishes a draft whose published_at has passed, with a scheduled POST_PUBLISHED audit row; leaves future and deleted drafts alone', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const due = await seedPost({ slug: uid('job-due'), translations: [{ lang: 'ar', title: 'due' }], is_published: false, published_at: past });
    const future = await seedPost({ slug: uid('job-future'), translations: [{ lang: 'ar', title: 'future' }], is_published: false, published_at: '2999-01-01T00:00:00Z' });
    const deleted = await seedPost({ slug: uid('job-deleted'), translations: [{ lang: 'ar', title: 'deleted' }], is_published: false, published_at: past, deleted: true });

    await fire('* * * * *');

    const rows = await withDb((q) => q('SELECT id::text AS id, is_published FROM posts WHERE id = ANY($1::uuid[])', [[due, future, deleted]]));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.is_published]))).toEqual({ [due]: true, [future]: false, [deleted]: false });

    const audits = await withDb((q) => q(`SELECT user_id, changes FROM audit_logs WHERE action = 'POST_PUBLISHED' AND resource_id = $1`, [due]));
    expect(audits).toEqual([{ user_id: null, changes: { scheduled: true, by: 'cron' } }]);
  });
});

describe('every minute: form notification outbox', () => {
  // The harness Worker has the simulated email binding (nothing leaves) and no cool-down (worker.env).
  it('announces pending submissions in one digest and clears an earlier failure flag; one past the 48 h window is left alone', async () => {
    const insert = (hoursAgo: number, failed = false) =>
      withDb(async (q) => {
        const [row] = await q(
          `INSERT INTO contact_submissions (name, email, message, submitted_at, notification_failed_at) VALUES ($1, 'jobs@example.test', 'hi', now() - make_interval(hours => $2), CASE WHEN $3 THEN now() ELSE NULL END) RETURNING id::text AS id`,
          [uid('job'), hoursAgo, failed],
        );
        return row.id as string;
      });
    const fresh = await insert(0, true);
    const stale = await insert(49);

    await fire('* * * * *');

    const rows = await withDb((q) => q('SELECT id::text AS id, notified_at, notification_failed_at FROM contact_submissions WHERE id = ANY($1::uuid[])', [[fresh, stale]]));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[fresh]).toMatchObject({ notified_at: expect.any(Date), notification_failed_at: null });
    expect(byId[stale]).toMatchObject({ notified_at: null, notification_failed_at: null });
  });
});

describe('hourly: orphan-upload cleanup', () => {
  it('deletes the object and the row of an expired pending upload; an unexpired one keeps both', async () => {
    const expired = `media/originals/${crypto.randomUUID()}/expired.jpg`;
    const live = `media/originals/${crypto.randomUUID()}/live.jpg`;
    await r2Put(expired);
    await r2Put(live);
    await withDb((q) =>
      q(`INSERT INTO pending_media_uploads (key, expires_at) VALUES ($1, now() - interval '1 minute'), ($2, now() + interval '10 minutes')`, [expired, live]),
    );

    await fire('0 * * * *');

    const keys = await withDb((q) => q('SELECT key FROM pending_media_uploads WHERE key = ANY($1)', [[expired, live]]));
    expect(keys.map((r) => r.key)).toEqual([live]);
    expect(await r2Exists(expired)).toBe(false);
    expect(await r2Exists(live)).toBe(true);
  });
});

describe('daily: retention', () => {
  it('drops expired and long-revoked refresh tokens and idle login counters; keeps live tokens and recent revocation tombstones', async () => {
    const tokens = await withDb(async (q) => {
      const [user] = await q('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1');
      const add = async (expires: string, revoked: string | null) => {
        const [row] = await q(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked_at)
           VALUES ($1, $2, now() + $3::interval, now() - $4::interval) RETURNING id::text AS id`,
          [user.id, uid('hash'), expires, revoked],
        );
        return row.id as string;
      };
      return {
        expired: await add('-1 minute', null),
        longRevoked: await add('7 days', '31 days'),
        tombstone: await add('7 days', '1 day'),
        live: await add('7 days', null),
      };
    });
    const [idle, recent] = [uid('idle'), uid('recent')];
    await withDb((q) =>
      q(`INSERT INTO login_attempts (username_key, last_failed_at) VALUES ($1, now() - interval '25 hours'), ($2, now() - interval '1 hour')`, [idle, recent]),
    );

    await fire('15 3 * * *');

    const kept = await withDb((q) => q('SELECT id::text AS id FROM refresh_tokens WHERE id = ANY($1::uuid[])', [Object.values(tokens)]));
    expect(kept.map((r) => r.id).sort()).toEqual([tokens.tombstone, tokens.live].sort());
    const attempts = await withDb((q) => q('SELECT username_key FROM login_attempts WHERE username_key = ANY($1)', [[idle, recent]]));
    expect(attempts.map((r) => r.username_key)).toEqual([recent]);
  });
});
