import { Injectable } from '@nestjs/common';
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
 * Cross-resource search. Posts, books, academic papers and gallery images are
 * each searched by their translation table (insensitive substring match on the
 * title and the most-readable secondary field). Results are bucketed by type
 * so the CMS / public site can render section headings without having to
 * group on the client.
 *
 * Public visibility rules:
 * - posts: must be `is_published=true` AND `deleted_at=null`.
 * - books / papers / gallery: `deleted_at=null` (these don't carry a publish
 *   flag — the absence of soft-delete means "live").
 *
 * Language resolution: each hit's `title` / `summary` is picked from the
 * matched translation row, then resolved against the request's `lang` only
 * if a same-language translation also matches the query — otherwise the
 * matched row is returned as-is. This keeps the result list faithful to
 * what the index actually matched, rather than silently swapping in a
 * default translation that didn't contain the query string.
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

    const data: Record<string, { items: Hit[]; total: number }> & { q: string } = { q };
    for (const { type, items } of buckets) {
      data[type] = { items, total: items.length };
    }

    return { message: 'Search results', data };
  }

  private async searchPosts(q: string, limit: number, lang: string | null): Promise<Hit[]> {
    const rows = await this.prisma.posts.findMany({
      where: {
        deleted_at: null,
        is_published: true,
        post_translations: {
          some: {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { body: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
      include: {
        post_translations: true,
        media: true,
      },
      orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
      take: limit,
    });

    return rows.map((post) => {
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
    const rows = await this.prisma.books.findMany({
      where: {
        deleted_at: null,
        book_translations: {
          some: {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { author: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
      include: {
        book_translations: true,
        media: true,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: limit,
    });

    return rows.map((book) => {
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
    const rows = await this.prisma.academic_papers.findMany({
      where: {
        deleted_at: null,
        academic_paper_translations: {
          some: {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { abstract: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
      include: {
        academic_paper_translations: true,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: limit,
    });

    return rows.map((paper) => {
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
    const rows = await this.prisma.gallery_images.findMany({
      where: {
        deleted_at: null,
        gallery_image_translations: {
          some: {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
      include: {
        gallery_image_translations: true,
        media: true,
      },
      orderBy: [{ created_at: 'desc' }, { media_id: 'asc' }],
      take: limit,
    });

    return rows.map((image) => {
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
