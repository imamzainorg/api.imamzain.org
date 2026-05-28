import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTranslation } from '../common/utils/translation.util';
import { SearchQueryDto, SearchResourceType } from './dto/search.dto';

type Hit = {
  type: SearchResourceType;
  id: string;
  title: string;
  summary: string | null;
  lang: string;
  slug: string | null;
  cover_image_url: string | null;
};

/**
 * Cross-resource search using PostgreSQL pg_trgm similarity. Each resource has
 * GIN trigram indexes on its translation tables (idx_*_title_trgm,
 * idx_*_body_trgm, etc. — see prisma/schema.prisma). The previous Prisma
 * `contains` filter compiled to `ILIKE '%q%'`, which the GIN indexes cannot
 * serve because of the leading wildcard. Using `%` (similarity_op) here means
 * the planner picks the GIN index and returns results in O(log n) instead of
 * O(n) sequential scan.
 *
 * `pg_trgm.similarity_threshold` defaults to 0.3 — low enough that "imam" still
 * matches "imamzain", high enough to keep noise down. Lowering further would
 * find more results but rapidly degrade relevance.
 *
 * Public visibility rules:
 * - posts: must be `is_published=true` AND `deleted_at=null`.
 * - books / papers / gallery: `deleted_at=null` (these don't carry a publish
 *   flag — the absence of soft-delete means "live").
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchQueryDto, lang: string | null) {
    const q = query.q.trim();
    const limit = query.limit ?? 10;
    const requestedTypes = query.types && query.types.length > 0
      ? new Set(query.types)
      : new Set<SearchResourceType>([
          SearchResourceType.Post,
          SearchResourceType.Book,
          SearchResourceType.AcademicPaper,
          SearchResourceType.GalleryImage,
        ]);

    const tasks: Array<Promise<{ type: SearchResourceType; items: Hit[] }>> = [];

    if (requestedTypes.has(SearchResourceType.Post)) {
      tasks.push(this.searchPosts(q, limit, lang).then((items) => ({ type: SearchResourceType.Post, items })));
    }
    if (requestedTypes.has(SearchResourceType.Book)) {
      tasks.push(this.searchBooks(q, limit, lang).then((items) => ({ type: SearchResourceType.Book, items })));
    }
    if (requestedTypes.has(SearchResourceType.AcademicPaper)) {
      tasks.push(this.searchPapers(q, limit, lang).then((items) => ({ type: SearchResourceType.AcademicPaper, items })));
    }
    if (requestedTypes.has(SearchResourceType.GalleryImage)) {
      tasks.push(this.searchGallery(q, limit, lang).then((items) => ({ type: SearchResourceType.GalleryImage, items })));
    }

    const buckets = await Promise.all(tasks);

    type SearchData = { q: string } & { [K in SearchResourceType]?: { items: Hit[]; total: number } };
    const data: SearchData = { q };
    for (const { type, items } of buckets) {
      data[type] = { items, total: items.length };
    }

    return { message: 'Search results', data };
  }

  /**
   * Stage 1: ask Postgres for the matching post ids via trigram similarity
   * (uses the GIN index). Stage 2: hydrate full rows + translations with
   * Prisma. The two-stage approach keeps the type-safety of Prisma's models
   * for the hydration while letting the planner use indexes the Prisma query
   * builder can't express.
   */
  private async searchPosts(q: string, limit: number, lang: string | null): Promise<Hit[]> {
    const matches = await this.prisma.$queryRaw<Array<{ post_id: string; score: number }>>(Prisma.sql`
      SELECT DISTINCT ON (pt.post_id)
        pt.post_id,
        GREATEST(similarity(pt.title, ${q}), similarity(LEFT(pt.body, 8000), ${q})) AS score
      FROM post_translations pt
      JOIN posts p ON p.id = pt.post_id
      WHERE p.deleted_at IS NULL
        AND p.is_published = TRUE
        AND (pt.title % ${q} OR pt.body % ${q})
      ORDER BY pt.post_id, score DESC
      LIMIT ${limit * 4}
    `);

    if (matches.length === 0) return [];

    const ranked = [...matches].sort((a, b) => b.score - a.score).slice(0, limit);
    const ids = ranked.map((m) => m.post_id);

    const rows = await this.prisma.posts.findMany({
      where: { id: { in: ids } },
      include: { post_translations: true, media: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    return ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((post) => {
        const matched = this.pickMatchedTranslation(post.post_translations, q, lang, ['title', 'body']);
        return {
          type: SearchResourceType.Post,
          id: post.id,
          title: matched?.title ?? '',
          summary: matched?.summary ?? null,
          lang: matched?.lang ?? '',
          slug: matched?.slug ?? null,
          cover_image_url: post.media?.url ?? null,
        };
      });
  }

  private async searchBooks(q: string, limit: number, lang: string | null): Promise<Hit[]> {
    const matches = await this.prisma.$queryRaw<Array<{ book_id: string; score: number }>>(Prisma.sql`
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
        AND (bt.title % ${q} OR bt.author % ${q} OR bt.description % ${q})
      ORDER BY bt.book_id, score DESC
      LIMIT ${limit * 4}
    `);

    if (matches.length === 0) return [];
    const ranked = [...matches].sort((a, b) => b.score - a.score).slice(0, limit);
    const ids = ranked.map((m) => m.book_id);

    const rows = await this.prisma.books.findMany({
      where: { id: { in: ids } },
      include: { book_translations: true, media: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    return ids
      .map((id) => byId.get(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((book) => {
        const matched = this.pickMatchedTranslation(book.book_translations, q, lang, ['title', 'author', 'description']);
        return {
          type: SearchResourceType.Book,
          id: book.id,
          title: matched?.title ?? '',
          summary: (matched?.description ?? matched?.author) ?? null,
          lang: matched?.lang ?? '',
          slug: null,
          cover_image_url: book.media?.url ?? null,
        };
      });
  }

  private async searchPapers(q: string, limit: number, lang: string | null): Promise<Hit[]> {
    const matches = await this.prisma.$queryRaw<Array<{ paper_id: string; score: number }>>(Prisma.sql`
      SELECT DISTINCT ON (apt.paper_id)
        apt.paper_id,
        GREATEST(similarity(apt.title, ${q}), similarity(COALESCE(apt.abstract, ''), ${q})) AS score
      FROM academic_paper_translations apt
      JOIN academic_papers ap ON ap.id = apt.paper_id
      WHERE ap.deleted_at IS NULL
        AND (apt.title % ${q} OR apt.abstract % ${q})
      ORDER BY apt.paper_id, score DESC
      LIMIT ${limit * 4}
    `);

    if (matches.length === 0) return [];
    const ranked = [...matches].sort((a, b) => b.score - a.score).slice(0, limit);
    const ids = ranked.map((m) => m.paper_id);

    const rows = await this.prisma.academic_papers.findMany({
      where: { id: { in: ids } },
      include: { academic_paper_translations: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    return ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((paper) => {
        const matched = this.pickMatchedTranslation(paper.academic_paper_translations, q, lang, ['title', 'abstract']);
        return {
          type: SearchResourceType.AcademicPaper,
          id: paper.id,
          title: matched?.title ?? '',
          summary: matched?.abstract ?? null,
          lang: matched?.lang ?? '',
          slug: null,
          cover_image_url: null,
        };
      });
  }

  private async searchGallery(q: string, limit: number, lang: string | null): Promise<Hit[]> {
    const matches = await this.prisma.$queryRaw<Array<{ media_id: string; score: number }>>(Prisma.sql`
      SELECT DISTINCT ON (git.media_id)
        git.media_id,
        GREATEST(similarity(git.title, ${q}), similarity(COALESCE(git.description, ''), ${q})) AS score
      FROM gallery_image_translations git
      JOIN gallery_images gi ON gi.media_id = git.media_id
      WHERE gi.deleted_at IS NULL
        AND (git.title % ${q} OR git.description % ${q})
      ORDER BY git.media_id, score DESC
      LIMIT ${limit * 4}
    `);

    if (matches.length === 0) return [];
    const ranked = [...matches].sort((a, b) => b.score - a.score).slice(0, limit);
    const ids = ranked.map((m) => m.media_id);

    const rows = await this.prisma.gallery_images.findMany({
      where: { media_id: { in: ids } },
      include: { gallery_image_translations: true, media: true },
    });
    const byId = new Map(rows.map((r) => [r.media_id, r]));

    return ids
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g))
      .map((image) => {
        const matched = this.pickMatchedTranslation(image.gallery_image_translations, q, lang, ['title', 'description']);
        return {
          type: SearchResourceType.GalleryImage,
          id: image.media_id,
          title: matched?.title ?? '',
          summary: matched?.description ?? null,
          lang: matched?.lang ?? '',
          slug: null,
          cover_image_url: image.media?.url ?? null,
        };
      });
  }

  /**
   * Prefer the translation that actually matched the query in the user's
   * language; otherwise fall back to the language-resolved or default
   * translation. This way an Arabic search that hits an English summary
   * still returns the English row instead of misleadingly showing the
   * Arabic default whose text doesn't contain `q`.
   */
  private pickMatchedTranslation<T extends { lang: string; is_default?: boolean } & Record<string, any>>(
    translations: T[],
    q: string,
    lang: string | null,
    matchFields: readonly string[],
  ): T | null {
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
}
