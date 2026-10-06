import { conflict } from './errors';

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
