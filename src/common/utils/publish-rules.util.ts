import { ConflictException } from '@nestjs/common';

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * The `published_at` a create/update request may store, given where the row
 * is coming from and where the request leaves it. Two invariants:
 *
 * 1. `is_published` ⇒ `published_at <= now`. A live row dated in the future
 *    (a scheduled post published early, or a future date typed onto a live
 *    post) sorts above everything real in every `published_at DESC` list —
 *    news index, homepage, RSS — and stays pinned until the date passes. So
 *    publishing keeps a PAST date (backdating is fine) and otherwise clamps
 *    to now.
 *
 * 2. A request never WRITES a past date onto an unpublished row. On such a row
 *    `published_at` is a schedule the publish cron consumes
 *    (`is_published = false AND published_at <= now`), so a past value means
 *    "publish me within the minute". That is how unpublishing through the CMS
 *    form — which always re-sends the stored date — silently undid itself, and
 *    how a "draft" saved with a backdate went live on its own.
 *    Only a FUTURE date is kept (a schedule); anything else becomes null.
 *
 *    The one past value left alone is the row's own stored date on a row that
 *    was already unpublished: that is a due schedule the cron is about to
 *    take, and an unrelated edit in that last minute must not cancel it.
 *
 * `requested` is `undefined` when the request did not mention published_at.
 */
export function resolvePublishedAt(params: {
  willBePublished: boolean;
  wasPublished: boolean;
  stored: Date | null;
  requested: Date | null | undefined;
  now?: Date;
}): Date | null {
  const { willBePublished, wasPublished, stored, requested } = params;
  const now = params.now ?? new Date();
  const candidate = requested === undefined ? stored : requested;

  if (willBePublished) return candidate !== null && candidate <= now ? candidate : now;

  if (candidate !== null && candidate > now) return candidate;
  if (!wasPublished && sameInstant(candidate, stored)) return stored;
  return null;
}

/**
 * A published row's slug is its public URL: it is in search indexes, in shared
 * links and in the RSS GUID. Renaming it used to 404 every one of those with
 * no redirect. Refuse the rename while the row is (and stays) published — the
 * editor can still change it deliberately by unpublishing first.
 *
 * Allowed: a first-time slug (null → value), any change on an unpublished row,
 * and a change made in the same request that unpublishes the row.
 */
export function assertSlugRenameAllowed(params: {
  resourceLabel: string;
  currentSlug: string | null;
  nextSlug: string | null | undefined;
  isPublished: boolean;
  willBePublished: boolean;
}): void {
  const { resourceLabel, currentSlug, nextSlug, isPublished, willBePublished } = params;
  if (nextSlug === undefined || nextSlug === currentSlug) return;
  if (currentSlug == null) return;
  if (!isPublished || !willBePublished) return;

  throw new ConflictException({
    message:
      `The slug of a published ${resourceLabel} cannot be changed — its URL is already public ` +
      '(shared links, search engines, the RSS feed). Unpublish it first if the URL really has to change.',
    code: 'SLUG_LOCKED_WHILE_PUBLISHED',
  });
}
