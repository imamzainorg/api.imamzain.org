import { ConflictException } from '@nestjs/common';
import { assertSlugRenameAllowed, resolvePublishedAt } from './publish-rules.util';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const PAST = new Date('2026-09-01T08:00:00.000Z');
const FUTURE = new Date('2026-10-01T08:00:00.000Z');

describe('resolvePublishedAt', () => {
  describe('row ends up published', () => {
    it('stamps now when there is no date', () => {
      expect(
        resolvePublishedAt({ willBePublished: true, wasPublished: false, stored: null, requested: undefined, now: NOW }),
      ).toEqual(NOW);
    });

    it('clamps a future date to now — a scheduled post published early', () => {
      expect(
        resolvePublishedAt({ willBePublished: true, wasPublished: false, stored: FUTURE, requested: undefined, now: NOW }),
      ).toEqual(NOW);
      expect(
        resolvePublishedAt({ willBePublished: true, wasPublished: true, stored: PAST, requested: FUTURE, now: NOW }),
      ).toEqual(NOW);
    });

    it('keeps a past date (backdating is allowed)', () => {
      expect(
        resolvePublishedAt({ willBePublished: true, wasPublished: false, stored: null, requested: PAST, now: NOW }),
      ).toEqual(PAST);
      expect(
        resolvePublishedAt({ willBePublished: true, wasPublished: true, stored: PAST, requested: undefined, now: NOW }),
      ).toEqual(PAST);
    });

    it('stamps now when the request clears the date on a live post', () => {
      expect(
        resolvePublishedAt({ willBePublished: true, wasPublished: true, stored: PAST, requested: null, now: NOW }),
      ).toEqual(NOW);
    });
  });

  describe('row ends up unpublished', () => {
    it('keeps a future date — that is a schedule', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: false, stored: null, requested: FUTURE, now: NOW }),
      ).toEqual(FUTURE);
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: true, stored: PAST, requested: FUTURE, now: NOW }),
      ).toEqual(FUTURE);
    });

    it('clears the date when a live post is unpublished without one', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: true, stored: PAST, requested: undefined, now: NOW }),
      ).toBeNull();
    });

    it('clears the stale date the CMS form re-sends when it unpublishes a live post', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: true, stored: PAST, requested: PAST, now: NOW }),
      ).toBeNull();
    });

    it('drops a past date typed onto a draft — the cron would publish it within a minute', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: false, stored: null, requested: PAST, now: NOW }),
      ).toBeNull();
    });

    it('leaves a due schedule alone on an unrelated edit, whether or not the date is re-sent', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: false, stored: PAST, requested: undefined, now: NOW }),
      ).toEqual(PAST);
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: false, stored: PAST, requested: new Date(PAST), now: NOW }),
      ).toEqual(PAST);
    });

    it('honours an explicit null (cancel the schedule)', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: false, stored: FUTURE, requested: null, now: NOW }),
      ).toBeNull();
    });

    it('keeps a plain draft undated', () => {
      expect(
        resolvePublishedAt({ willBePublished: false, wasPublished: false, stored: null, requested: undefined, now: NOW }),
      ).toBeNull();
    });
  });
});

describe('assertSlugRenameAllowed', () => {
  const base = { resourceLabel: 'post', currentSlug: 'old-slug', isPublished: true, willBePublished: true };

  it('refuses to rename the slug of a row that is and stays published', () => {
    expect(() => assertSlugRenameAllowed({ ...base, nextSlug: 'new-slug' })).toThrow(ConflictException);
    try {
      assertSlugRenameAllowed({ ...base, nextSlug: 'new-slug' });
    } catch (err) {
      expect((err as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'SLUG_LOCKED_WHILE_PUBLISHED' }),
      );
    }
  });

  it.each([
    ['the slug is not part of the request', { nextSlug: undefined }],
    ['the slug is unchanged (the CMS re-sends it on every save)', { nextSlug: 'old-slug' }],
    ['the row is unpublished', { nextSlug: 'new-slug', isPublished: false, willBePublished: false }],
    ['the same request unpublishes the row', { nextSlug: 'new-slug', willBePublished: false }],
    ['a draft is renamed and published in one request', { nextSlug: 'new-slug', isPublished: false }],
    ['a published row gets its first slug', { nextSlug: 'new-slug', currentSlug: null }],
  ])('allows it when %s', (_label, overrides) => {
    expect(() => assertSlugRenameAllowed({ ...base, ...overrides })).not.toThrow();
  });
});
