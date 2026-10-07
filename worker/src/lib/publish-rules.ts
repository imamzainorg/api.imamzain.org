import { conflict } from './errors';

const sameInstant = (a: Date | null, b: Date | null): boolean => (a === null || b === null ? a === b : a.getTime() === b.getTime());

/**
 * src/common/utils/publish-rules.util.ts: the `published_at` a create/update may store. A live row is
 * never future-dated or undated (it would pin itself to the top of every `published_at DESC` list);
 * an unpublished row only keeps a FUTURE date, a schedule the publish cron consumes, except its own
 * stored date when it was already unpublished (a due schedule the cron is about to take).
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
 * src/common/utils/publish-rules.util.ts: a published row's slug is its public URL, so it can't be
 * renamed while the row is (and stays) published. A first-time slug, any change on an unpublished row
 * and a rename in the request that unpublishes the row are allowed.
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

  throw conflict(
    `The slug of a published ${resourceLabel} cannot be changed — its URL is already public ` +
      '(shared links, search engines, the RSS feed). Unpublish it first if the URL really has to change.',
    { code: 'SLUG_LOCKED_WHILE_PUBLISHED' },
  );
}
