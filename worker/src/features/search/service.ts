import type { Context } from 'hono';
import { Prisma } from '../../generated/prisma/client';
import { getDb } from '../../lib/db';
import { loadActiveLanguages, onlyActiveTranslations, resolveTranslation } from '../../lib/i18n';
import { MEDIA_URL_WITH_VARIANTS_SELECT } from '../../lib/media-selects';
import type { AppEnv } from '../../lib/types';
import { SEARCH_TYPES, type SearchInput, type SearchType } from './schemas';

type Ctx = Context<AppEnv>;
type ImageVariant = { id: string; width: number; url: string; format: string };
type Active = ReadonlySet<string>;

interface Hit {
  type: SearchType;
  id: string;
  title: string;
  summary: string | null;
  lang: string;
  slug: string | null;
  cover_image_url: string | null;
  cover_image_variants: ImageVariant[];
}

// The SQL stage can't know which languages are live, so a hit whose every matching row is in a retired
// language (no title to show) is dropped here.
const hasLiveTranslation = (hit: Hit): boolean => hit.lang !== '';

/**
 * Cross-resource search over pg_trgm: the `%` operator lets the planner use the GIN trigram indexes
 * (a Prisma `contains` is `ILIKE '%q%'`, which they can't serve). Stage 1 asks Postgres for the
 * matching ids by similarity; stage 2 hydrates them with Prisma, keeping stage 1's order.
 */
export async function search(c: Ctx, query: SearchInput, lang: string | null) {
  const db = getDb(c);
  const { q, limit } = query;
  const requested = new Set<SearchType>(
    query.types && query.types.length > 0 ? query.types : SEARCH_TYPES,
  );
  const active = await loadActiveLanguages(db);

  const searchers: Record<
    SearchType,
    (db: Db, q: string, limit: number, lang: string | null, active: Active) => Promise<Hit[]>
  > = {
    post: searchPosts,
    book: searchBooks,
    academic_paper: searchPapers,
    gallery_image: searchGallery,
    audio: searchAudios,
  };
  // Buckets keep the fixed order above, whatever order `types` came in.
  const buckets = await Promise.all(
    SEARCH_TYPES.filter((t) => requested.has(t)).map(async (type) => ({
      type,
      items: await searchers[type](db, q, limit, lang, active),
    })),
  );

  const data: { q: string } & { [K in SearchType]?: { items: Hit[]; total: number } } = { q };
  for (const { type, items } of buckets) data[type] = { items, total: items.length };
  return { message: 'Search results', data };
}

type Db = ReturnType<typeof getDb>;

async function searchPosts(
  db: Db,
  q: string,
  limit: number,
  lang: string | null,
  active: Active,
): Promise<Hit[]> {
  const matches = await db.$queryRaw<Array<{ post_id: string; score: number }>>(Prisma.sql`
    SELECT post_id, score FROM (
      SELECT DISTINCT ON (pt.post_id)
        pt.post_id,
        GREATEST(similarity(pt.title, ${q}), similarity(LEFT(pt.body, 8000), ${q})) AS score
      FROM post_translations pt
      JOIN posts p ON p.id = pt.post_id
      WHERE p.deleted_at IS NULL
        AND p.is_published = TRUE
        AND (pt.title % ${q} OR pt.body % ${q})
      ORDER BY pt.post_id, score DESC
    ) sub
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.post_id);

  // `body` is selected because matchFields checks it, not just for display.
  const rows = await db.posts.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slug: true,
      post_translations: {
        select: { lang: true, title: true, summary: true, body: true, is_default: true },
      },
      media: { select: MEDIA_URL_WITH_VARIANTS_SELECT },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((post): Hit => {
      const matched = pickMatchedTranslation(
        post.post_translations,
        q,
        lang,
        ['title', 'body'],
        active,
      );
      return {
        type: 'post',
        id: post.id,
        title: matched?.title ?? '',
        summary: matched?.summary ?? null,
        lang: matched?.lang ?? '',
        slug: post.slug ?? null,
        cover_image_url: post.media?.url ?? null,
        cover_image_variants: post.media?.media_variants ?? [],
      };
    })
    .filter(hasLiveTranslation);
}

async function searchBooks(
  db: Db,
  q: string,
  limit: number,
  lang: string | null,
  active: Active,
): Promise<Hit[]> {
  const matches = await db.$queryRaw<Array<{ book_id: string; score: number }>>(Prisma.sql`
    SELECT book_id, score FROM (
      SELECT DISTINCT ON (bt.book_id)
        bt.book_id,
        GREATEST(
          similarity(bt.title, ${q}),
          similarity(COALESCE(bt.author, ''), ${q}),
          similarity(COALESCE(bt.description, ''), ${q})
        ) AS score
      FROM book_translations bt
      JOIN books b ON b.id = bt.book_id
      WHERE b.deleted_at IS NULL
        AND b.is_published = true
        AND b.parent_id IS NULL
        AND (bt.title % ${q} OR bt.author % ${q} OR bt.description % ${q})
      ORDER BY bt.book_id, score DESC
    ) sub
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.book_id);

  const rows = await db.books.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slug: true,
      book_translations: {
        select: { lang: true, title: true, author: true, description: true, is_default: true },
      },
      media: { select: MEDIA_URL_WITH_VARIANTS_SELECT },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return ids
    .map((id) => byId.get(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map((book): Hit => {
      const matched = pickMatchedTranslation(
        book.book_translations,
        q,
        lang,
        ['title', 'author', 'description'],
        active,
      );
      return {
        type: 'book',
        id: book.id,
        title: matched?.title ?? '',
        summary: matched?.description ?? matched?.author ?? null,
        lang: matched?.lang ?? '',
        slug: book.slug ?? null,
        cover_image_url: book.media?.url ?? null,
        cover_image_variants: book.media?.media_variants ?? [],
      };
    })
    .filter(hasLiveTranslation);
}

async function searchPapers(
  db: Db,
  q: string,
  limit: number,
  lang: string | null,
  active: Active,
): Promise<Hit[]> {
  const matches = await db.$queryRaw<Array<{ paper_id: string; score: number }>>(Prisma.sql`
    SELECT paper_id, score FROM (
      SELECT DISTINCT ON (apt.paper_id)
        apt.paper_id,
        GREATEST(similarity(apt.title, ${q}), similarity(COALESCE(apt.abstract, ''), ${q})) AS score
      FROM academic_paper_translations apt
      JOIN academic_papers ap ON ap.id = apt.paper_id
      WHERE ap.deleted_at IS NULL
        AND ap.is_published = true
        AND (apt.title % ${q} OR apt.abstract % ${q})
      ORDER BY apt.paper_id, score DESC
    ) sub
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.paper_id);

  const rows = await db.academic_papers.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      academic_paper_translations: {
        select: { lang: true, title: true, abstract: true, is_default: true },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((paper): Hit => {
      const matched = pickMatchedTranslation(
        paper.academic_paper_translations,
        q,
        lang,
        ['title', 'abstract'],
        active,
      );
      return {
        type: 'academic_paper',
        id: paper.id,
        title: matched?.title ?? '',
        summary: matched?.abstract ?? null,
        lang: matched?.lang ?? '',
        slug: null,
        cover_image_url: null,
        cover_image_variants: [],
      };
    })
    .filter(hasLiveTranslation);
}

async function searchGallery(
  db: Db,
  q: string,
  limit: number,
  lang: string | null,
  active: Active,
): Promise<Hit[]> {
  const matches = await db.$queryRaw<Array<{ media_id: string; score: number }>>(Prisma.sql`
    SELECT media_id, score FROM (
      SELECT DISTINCT ON (git.media_id)
        git.media_id,
        GREATEST(similarity(git.title, ${q}), similarity(COALESCE(git.description, ''), ${q})) AS score
      FROM gallery_image_translations git
      JOIN gallery_images gi ON gi.media_id = git.media_id
      WHERE gi.deleted_at IS NULL
        AND gi.is_published = true
        AND (git.title % ${q} OR git.description % ${q})
      ORDER BY git.media_id, score DESC
    ) sub
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.media_id);

  const rows = await db.gallery_images.findMany({
    where: { media_id: { in: ids } },
    select: {
      media_id: true,
      gallery_image_translations: {
        select: { lang: true, title: true, description: true, is_default: true },
      },
      media: { select: MEDIA_URL_WITH_VARIANTS_SELECT },
    },
  });
  const byId = new Map(rows.map((r) => [r.media_id, r]));

  return ids
    .map((id) => byId.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((image): Hit => {
      const matched = pickMatchedTranslation(
        image.gallery_image_translations,
        q,
        lang,
        ['title', 'description'],
        active,
      );
      return {
        type: 'gallery_image',
        id: image.media_id,
        title: matched?.title ?? '',
        summary: matched?.description ?? null,
        lang: matched?.lang ?? '',
        slug: null,
        cover_image_url: image.media?.url ?? null,
        cover_image_variants: image.media?.media_variants ?? [],
      };
    })
    .filter(hasLiveTranslation);
}

/**
 * Audios match on their translation title and their live speaker's translated name; the GROUP BY
 * collapses the translations to one best score. Visibility follows the posts rule (published, not deleted).
 */
async function searchAudios(
  db: Db,
  q: string,
  limit: number,
  lang: string | null,
  active: Active,
): Promise<Hit[]> {
  const matches = await db.$queryRaw<Array<{ id: string; score: number }>>(Prisma.sql`
    SELECT a.id, GREATEST(
      MAX(similarity(at.title, ${q})),
      COALESCE(MAX(similarity(sp.name, ${q})), 0)
    ) AS score
    FROM audios a
    JOIN audio_translations at ON at.audio_id = a.id
    LEFT JOIN speakers s ON s.id = a.speaker_id AND s.deleted_at IS NULL
    LEFT JOIN speaker_translations sp ON sp.speaker_id = s.id
    WHERE a.deleted_at IS NULL
      AND a.is_published = TRUE
      AND (at.title % ${q} OR sp.name % ${q})
    GROUP BY a.id
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.id);

  const rows = await db.audios.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slug: true,
      audio_translations: { select: { lang: true, title: true, is_default: true } },
      speakers: {
        select: {
          deleted_at: true,
          speaker_translations: { select: { lang: true, name: true, is_default: true } },
        },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return ids
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((audio): Hit => {
      const matched = pickMatchedTranslation(audio.audio_translations, q, lang, ['title'], active);
      // A trashed speaker is neither matched (SQL above) nor named in the summary.
      const speaker = resolveTranslation(
        audio.speakers && !audio.speakers.deleted_at ? audio.speakers.speaker_translations : null,
        matched?.lang ?? lang,
        { active },
      );
      return {
        type: 'audio',
        id: audio.id,
        title: matched?.title ?? '',
        summary: speaker?.name ?? null,
        lang: matched?.lang ?? '',
        slug: audio.slug ?? null,
        cover_image_url: null,
        cover_image_variants: [],
      };
    })
    .filter(hasLiveTranslation);
}

/**
 * The translation that actually contains the query in the user's language, else the language-resolved
 * one: an Arabic search that hits an English summary returns the English row. A translation in a
 * retired language never qualifies, even when it is the one that matched in SQL.
 */
function pickMatchedTranslation<T extends { lang: string; is_default?: boolean }>(
  allTranslations: T[],
  q: string,
  lang: string | null,
  matchFields: readonly (keyof T)[],
  active: Active,
): T | null {
  const translations = onlyActiveTranslations(allTranslations, active);
  if (translations.length === 0) return null;
  const needle = q.toLowerCase();
  const matches = translations.filter((t) =>
    matchFields.some((field) => {
      const v = t[field];
      return typeof v === 'string' && v.toLowerCase().includes(needle);
    }),
  );

  if (matches.length > 0) {
    if (lang) {
      const sameLang = matches.find((m) => m.lang === lang);
      if (sameLang) return sameLang;
    }
    return resolveTranslation(matches, lang) ?? matches[0];
  }

  return resolveTranslation(translations, lang);
}
