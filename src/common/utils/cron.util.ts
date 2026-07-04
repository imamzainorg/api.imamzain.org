/**
 * True when background cron ticks are disabled for this process. Operator
 * scripts (prisma/upload-missing-r2, reconcile-audios, backfill-media-variants)
 * boot the full AppModule for its providers and set DISABLE_CRON=true so a
 * long-running maintenance run never executes production ticks (newsletter
 * sends, scheduled publishing, YouTube sync, cleanup jobs).
 */
export function cronsDisabled(): boolean {
  return process.env.DISABLE_CRON === 'true';
}
