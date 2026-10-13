// Cron Triggers (plan, Phase 5). A trigger fires once per schedule, so Nest's advisory locks are gone;
// the YouTube freshness check stays as the guard against a repeated tick.
import type { PrismaClient } from '../generated/prisma/client';
import { db as createDb } from '../lib/db';
import type { AppBindings } from '../lib/types';
import { drainOutbox } from './form-notifications';
import { cleanupOrphanUploads } from './orphan-uploads';
import { runRetention } from './retention';
import { runScheduledPublish } from './scheduled-publish';
import { runGuardedSync } from './youtube-sync';

/** The schedules in wrangler.jsonc's `triggers.crons`; keep both in step. */
export const CRONS = {
  everyMinute: '* * * * *',
  hourly: '0 * * * *',
  daily: '15 3 * * *',
} as const;

/** `scheduled` is the trigger's own time (the hour gate); the jobs themselves use the wall clock, as Nest did. */
type Job = (db: PrismaClient, env: AppBindings, scheduled: Date) => Promise<unknown>;

const JOBS: Record<string, [name: string, job: Job][]> = {
  [CRONS.everyMinute]: [
    ['scheduled-publish', (db) => runScheduledPublish(db)],
    ['form-notifications', (db, env) => drainOutbox(db, env)],
  ],
  [CRONS.hourly]: [
    ['orphan-uploads', (db, env) => cleanupOrphanUploads(db, env)],
    // Nest ran it at 0 */6 * * *; one hourly trigger covers both jobs.
    ['youtube-sync', (db, env, scheduled) => (scheduled.getUTCHours() % 6 === 0 ? runGuardedSync(db, env) : Promise.resolve())],
  ],
  [CRONS.daily]: [['retention', (db) => runRetention(db)]],
};

/** Runs the jobs of one trigger in order; a failing job is logged and doesn't stop the next one. */
export async function runScheduled(cron: string, env: AppBindings, scheduledTime: number): Promise<void> {
  const jobs = JOBS[cron];
  if (!jobs) {
    console.warn(`No jobs for cron "${cron}"`);
    return;
  }
  const scheduled = new Date(scheduledTime);
  const db = createDb(env);
  try {
    for (const [name, job] of jobs) {
      try {
        await job(db, env, scheduled);
      } catch (err) {
        console.error(`Job ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await db.$disconnect().catch((err) => console.warn(`$disconnect failed: ${err}`));
  }
}
