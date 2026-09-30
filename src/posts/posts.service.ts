import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { cronsDisabled } from '../common/utils/cron.util';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { readingTimeMinutes } from '../common/utils/reading-time.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { assertExactlyOneDefault, resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../common/utils/advisory-lock.util';
import { publicWhere } from '../common/utils/visibility.util';
import { assertSlugRenameAllowed, resolvePublishedAt } from '../common/utils/publish-rules.util';
import { MEDIA_VARIANT_SELECT, OG_IMAGE_SELECT, PUBLIC_MEDIA_SELECT } from '../common/crud/media-selects';
import { BulkIdsDto, BulkPublishDto, CreatePostDto, PostQueryDto, PostSort, PostStatus, TogglePublishDto, UpdatePostDto } from './dto/post.dto';
import { ViewDedupService } from './view-dedup.service';

const POST_DETAIL_INCLUDE = {
  post_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
  post_categories: { include: { post_category_translations: true } },
  media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } },
  post_attachments: {
    include: { media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } } },
    orderBy: { display_order: 'asc' },
  },
} satisfies Prisma.postsInclude;

// The PUBLIC detail shape. Admin reads keep POST_DETAIL_INCLUDE (full rows, so
// the CMS still sees created_by and the media bookkeeping columns); an
// anonymous caller gets an explicit column list instead: no staff UUID
// (`created_by`), and embedded media reduced to PUBLIC_MEDIA_SELECT (no
// file_size / uploaded_by).
const POST_PUBLIC_DETAIL_SELECT = {
  id: true,
  category_id: true,
  cover_image_id: true,
  slug: true,
  is_published: true,
  is_featured: true,
  published_at: true,
  views: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  post_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
  post_categories: { include: { post_category_translations: true } },
  media: { select: PUBLIC_MEDIA_SELECT },
  post_attachments: {
    select: { post_id: true, media_id: true, display_order: true, media: { select: PUBLIC_MEDIA_SELECT } },
    orderBy: { display_order: 'asc' },
  },
} satisfies Prisma.postsSelect;

// List queries drop the full `body` from translations (typically 5-50 KB of
// HTML each, multiplied by N translations × page size) and collapse the
// category's full translation array to a single resolved row. Detail still
// returns everything.
const POST_LIST_TRANSLATION_SELECT = {
  post_id: true,
  lang: true,
  title: true,
  summary: true,
  is_default: true,
  meta_title: true,
  meta_description: true,
  og_image_id: true,
} satisfies Prisma.post_translationsSelect;

const POST_LIST_SELECT = {
  id: true,
  category_id: true,
  cover_image_id: true,
  slug: true,
  is_published: true,
  is_featured: true,
  published_at: true,
  views: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  post_translations: { select: POST_LIST_TRANSLATION_SELECT },
  post_categories: {
    select: {
      id: true,
      created_at: true,
      post_category_translations: {
        select: { category_id: true, lang: true, title: true, slug: true, description: true },
      },
    },
  },
  media: { select: PUBLIC_MEDIA_SELECT },
  post_attachments: {
    take: 1,
    select: { post_id: true, media_id: true, display_order: true, media: { select: { id: true, url: true, mime_type: true, filename: true } } },
    orderBy: { display_order: 'asc' },
  },
} satisfies Prisma.postsSelect;

/** Decorate a translation row with the derived `reading_time_minutes`. */
function withReadingTime<T extends { body?: string | null }>(t: T): T & { reading_time_minutes: number } {
  return { ...t, reading_time_minutes: readingTimeMinutes(t.body ?? null) };
}

/** List translations carry no body — reading time is unknown without it, so report 0. */
function withZeroReadingTime<T extends Record<string, unknown>>(t: T): T & { reading_time_minutes: number } {
  return { ...t, reading_time_minutes: 0 };
}

/**
 * Message per violated unique index, for `rethrowP2002AsConflict`. Only the
 * slug index may produce the "slug already used" text: the other unique keys a
 * post write can hit are the (post, lang) and (post, media) primary keys of its
 * child tables, and reporting those as a slug clash sent editors hunting for a
 * slug problem that did not exist.
 */
function postConflictMessages(slug: string | undefined): { fallback: string; byTarget: Record<string, string> } {
  return {
    fallback: 'A value in this request is already in use by another record',
    byTarget: {
      slug: slug ? `Slug "${slug}" is already used by another post` : 'The slug is already used by another post',
      post_translations: 'The same language appears more than once in translations',
      lang: 'The same language appears more than once in translations',
      post_attachments: 'The same media file appears more than once in attachment_ids',
      media_id: 'The same media file appears more than once in attachment_ids',
    },
  };
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly viewDedup: ViewDedupService,
  ) {}

  async findAll(query: PostQueryDto, lang: string | null, isAdmin = false) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.postsWhereInput = { deleted_at: null };
    if (!isAdmin) {
      where.is_published = true;
    } else if (query.status && query.status !== PostStatus.All) {
      // Admin status filter. Public route ignores it — public callers only
      // ever see published posts; the filter is meaningful for the CMS only.
      const now = new Date();
      if (query.status === PostStatus.Published) {
        where.is_published = true;
      } else if (query.status === PostStatus.Draft) {
        where.is_published = false;
        where.OR = [
          { published_at: null },
          { published_at: { lte: now } },
        ];
      } else if (query.status === PostStatus.Scheduled) {
        where.is_published = false;
        where.published_at = { gt: now };
      }
    }
    if (query.category_id) where.category_id = query.category_id;
    if (query.featured !== undefined) where.is_featured = query.featured;

    if (query.search) {
      where.post_translations = {
        some: {
          AND: [
            {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { body: { contains: query.search, mode: 'insensitive' } },
              ],
            },
            lang ? { OR: [{ lang }, { is_default: true }] } : { is_default: true },
          ],
        },
      };
    }

    const orderBy: Prisma.postsOrderByWithRelationInput[] =
      query.sort === PostSort.Views
        ? [{ views: 'desc' }, { id: 'asc' }]
        : [{ published_at: 'desc' }, { created_at: 'desc' }, { id: 'asc' }];

    const [items, total] = await Promise.all([
      this.prisma.posts.findMany({
        where,
        select: POST_LIST_SELECT,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.posts.count({ where }),
    ]);

    const mapped = items.map((post) => {
      const decorated = post.post_translations.map(withZeroReadingTime);
      return {
        ...post,
        post_translations: decorated,
        translation: resolveTranslation(decorated, lang),
      };
    });

    return {
      message: 'Posts fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  async findOne(id: string, lang: string | null, isAdmin = false) {
    const where: Prisma.postsWhereInput = { id, deleted_at: null };
    if (!isAdmin) where.is_published = true;

    const post = isAdmin
      ? await this.prisma.posts.findFirst({ where, include: POST_DETAIL_INCLUDE })
      : await this.prisma.posts.findFirst({ where, select: POST_PUBLIC_DETAIL_SELECT });

    if (!post) throw new NotFoundException('Post not found');

    return this.presentDetail(post, lang);
  }

  /** Public detail by canonical slug — one language-agnostic slug per post. */
  async findBySlug(slug: string, lang: string | null) {
    const post = await this.prisma.posts.findFirst({
      where: { slug, ...publicWhere(true) },
      select: POST_PUBLIC_DETAIL_SELECT,
    });
    if (!post) throw new NotFoundException('Post not found');

    return this.presentDetail(post, lang);
  }

  private presentDetail<T extends { post_translations: { body?: string | null; lang?: string; is_default?: boolean }[] }>(
    post: T,
    lang: string | null,
  ) {
    const decorated = post.post_translations.map(withReadingTime);
    return {
      message: 'Post fetched',
      data: { ...post, post_translations: decorated, translation: resolveTranslation(decorated, lang) },
    };
  }

  async create(dto: CreatePostDto, userId: string, lang: string | null) {
    const category = await this.prisma.post_categories.findFirst({
      where: { id: dto.category_id, deleted_at: null },
    });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.cover_image_id) {
      const media = await this.prisma.media.findUnique({ where: { id: dto.cover_image_id } });
      if (!media) throw new NotFoundException('Cover image not found');
    }

    await this.assertOgImagesExist(dto.translations);

    assertExactlyOneDefault(dto.translations);
    await this.assertSlugAvailable(dto.slug, null);

    // A post created already-published must carry a published_at that is not
    // in the future: NULL sorts NULLS FIRST under `ORDER BY published_at DESC`
    // (the public list, homepage and RSS feed all use it) and a future date
    // sorts above everything real — either pins the post to the top of every
    // list. A draft only keeps a FUTURE date (a schedule); a past one would be
    // picked up by the publish cron and put the "draft" live within a minute.
    const isPublished = dto.is_published ?? false;
    const publishedAt = resolvePublishedAt({
      willBePublished: isPublished,
      wasPublished: false,
      stored: null,
      requested: dto.published_at ? new Date(dto.published_at) : null,
    });

    let post;
    try {
      post = await this.prisma.$transaction(async (tx) => {
        const created = await tx.posts.create({
          data: {
            category_id: dto.category_id,
            cover_image_id: dto.cover_image_id ?? null,
            slug: dto.slug,
            is_published: isPublished,
            is_featured: dto.is_featured ?? false,
            published_at: publishedAt,
            created_by: userId,
          },
        });

        await tx.post_translations.createMany({
          data: dto.translations.map((t) => ({
            post_id: created.id,
            lang: t.lang,
            title: t.title,
            summary: t.summary ?? null,
            body: sanitizeEditorHtml(t.body),
            is_default: t.is_default ?? false,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
          })),
        });

        if (dto.attachment_ids && dto.attachment_ids.length > 0) {
          await tx.post_attachments.createMany({
            data: dto.attachment_ids.map((mediaId, index) => ({
              post_id: created.id,
              media_id: mediaId,
              display_order: index,
            })),
          });
        }

        return created;
      });
    } catch (err) {
      const { fallback, byTarget } = postConflictMessages(dto.slug);
      rethrowP2002AsConflict(err, fallback, byTarget);
    }

    this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.POST_CREATED,
      resourceType: 'post',
      resourceId: post.id,
      changes: { method: 'POST', path: '/api/v1/posts' },
    });

    const { data } = await this.findOne(post.id, lang, true);
    return { message: 'Post created', data };
  }

  async update(id: string, dto: UpdatePostDto, userId: string, lang: string | null) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null } });
    if (!post) throw new NotFoundException('Post not found');

    if (dto.category_id !== undefined && dto.category_id !== post.category_id) {
      const category = await this.prisma.post_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    if (dto.cover_image_id) {
      const media = await this.prisma.media.findUnique({ where: { id: dto.cover_image_id } });
      if (!media) throw new NotFoundException('Cover image not found');
    }

    if (dto.translations) await this.assertOgImagesExist(dto.translations);

    assertSlugRenameAllowed({
      resourceLabel: 'post',
      currentSlug: post.slug,
      nextSlug: dto.slug,
      isPublished: post.is_published,
      willBePublished: dto.is_published ?? post.is_published,
    });
    if (dto.slug !== undefined) await this.assertSlugAvailable(dto.slug, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        const updateData: Prisma.postsUpdateInput = { updated_at: new Date() };
        if (dto.category_id !== undefined) updateData.post_categories = { connect: { id: dto.category_id } };
        if (dto.cover_image_id !== undefined) {
          updateData.media = dto.cover_image_id
            ? { connect: { id: dto.cover_image_id } }
            : { disconnect: true };
        }
        if (dto.slug !== undefined) updateData.slug = dto.slug;
        if (dto.is_published !== undefined) updateData.is_published = dto.is_published;
        if (dto.is_featured !== undefined) updateData.is_featured = dto.is_featured;

        // published_at is never copied straight from the request — see
        // resolvePublishedAt for the two invariants it keeps (a live post is
        // never future-dated or undated; an unpublished post never carries a
        // past date the publish cron would act on, which is what the CMS form
        // sends when it unpublishes: the stored date, verbatim).
        const nextPublishedAt = resolvePublishedAt({
          willBePublished: dto.is_published ?? post.is_published,
          wasPublished: post.is_published,
          stored: post.published_at,
          requested: dto.published_at === undefined ? undefined : dto.published_at ? new Date(dto.published_at) : null,
        });
        if (nextPublishedAt?.getTime() !== post.published_at?.getTime()) {
          updateData.published_at = nextPublishedAt;
        }

        await tx.posts.update({ where: { id }, data: updateData });

        if (dto.translations) {
          for (const t of dto.translations) {
            const cleanBody = sanitizeEditorHtml(t.body);
            const translationData = {
              title: t.title,
              summary: t.summary ?? null,
              body: cleanBody,
              is_default: t.is_default ?? false,
              meta_title: t.meta_title ?? null,
              meta_description: t.meta_description ?? null,
              og_image_id: t.og_image_id ?? null,
            };
            await tx.post_translations.upsert({
              where: { post_id_lang: { post_id: id, lang: t.lang } },
              create: { post_id: id, lang: t.lang, ...translationData },
              update: translationData,
            });
          }

          // Re-assert the single-default invariant once all upserts have landed:
          // a partial update that flips is_default on one row must not leave 0
          // or 2+ defaults.
          const defaults = await tx.post_translations.count({
            where: { post_id: id, is_default: true },
          });
          if (defaults !== 1) {
            throw new BadRequestException('Exactly one translation must have is_default: true');
          }
        }

        if (dto.attachment_ids !== undefined) {
          await tx.post_attachments.deleteMany({ where: { post_id: id } });
          if (dto.attachment_ids.length > 0) {
            await tx.post_attachments.createMany({
              data: dto.attachment_ids.map((mediaId, index) => ({
                post_id: id,
                media_id: mediaId,
                display_order: index,
              })),
            });
          }
        }
      });
    } catch (err) {
      const { fallback, byTarget } = postConflictMessages(dto.slug);
      rethrowP2002AsConflict(err, fallback, byTarget);
    }

    this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.POST_UPDATED,
      resourceType: 'post',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/posts/${id}` },
    });

    const { data } = await this.findOne(id, lang, true);
    return { message: 'Post updated', data };
  }

  /**
   * Validate every translation-level og_image_id up front so a bad one surfaces
   * as 404 with a useful message instead of a Prisma FK error.
   */
  private async assertOgImagesExist(translations: { og_image_id?: string }[]): Promise<void> {
    const ogImageIds = translations
      .map((t) => t.og_image_id)
      .filter((v): v is string => typeof v === 'string');
    if (ogImageIds.length === 0) return;
    const found = await this.prisma.media.findMany({
      where: { id: { in: ogImageIds } },
      select: { id: true },
    });
    if (found.length !== new Set(ogImageIds).size) {
      throw new NotFoundException('One or more og_image_id values do not match any media record');
    }
  }

  /** Reject a slug that collides with another live post's slug. */
  private async assertSlugAvailable(slug: string, excludePostId: string | null): Promise<void> {
    const conflict = await this.prisma.posts.findFirst({
      where: { slug, ...(excludePostId ? { NOT: { id: excludePostId } } : {}) },
      select: { id: true },
    });
    if (conflict) throw new ConflictException(`Slug "${slug}" is already used by another post`);
  }

  async togglePublish(id: string, dto: TogglePublishDto, actorId: string, lang: string | null) {
    const post = await this.prisma.posts.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, is_published: true, published_at: true },
    });
    if (!post) throw new NotFoundException('Post not found');

    // Already in the requested state: nothing changes, so no audit row and no
    // updated_at bump (the sibling modules and bulkSetPublish behave the same).
    // A schedule on an unpublished post is left alone — cancel it with
    // PATCH /posts/:id { published_at: null }.
    if (post.is_published === dto.is_published) {
      const { data } = await this.findOne(id, lang, true);
      return { message: 'Post already in requested state', data };
    }

    const now = new Date();
    const updateData: Prisma.postsUpdateInput = { is_published: dto.is_published, updated_at: now };
    if (dto.is_published) {
      // "Publish now" on a scheduled post must not keep its future date — a
      // live, future-dated post pins itself to the top of every list. A past
      // date (a due schedule the cron had not reached yet) is kept.
      if (!post.published_at || post.published_at > now) updateData.published_at = now;
    } else {
      // Unpublishing must also clear published_at. The scheduled-publish cron
      // selects `is_published = false AND published_at <= now`, so a past
      // timestamp left in place would re-publish the post within a minute.
      // A later publish stamps a fresh timestamp.
      updateData.published_at = null;
    }

    await this.prisma.posts.update({ where: { id }, data: updateData });

    const action = dto.is_published ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_UNPUBLISHED;
    this.audit.write({
      actorId,
      action,
      resourceType: 'post',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/posts/${id}/publish`, is_published: dto.is_published },
    });

    const { data } = await this.findOne(id, lang, true);
    return { message: `Post ${dto.is_published ? 'published' : 'unpublished'}`, data };
  }

  /**
   * Auto-publish posts whose `published_at` has arrived.
   *
   * Editors set a future `published_at` and leave `is_published=false`; this
   * cron flips them to `is_published=true` once the timestamp is reached.
   * Runs every minute — cheap query (indexed on deleted_at + is_published)
   * with a tight WHERE clause. The flip is now a single updateMany + a
   * single batched audit-log insert; the previous implementation looped one
   * UPDATE + one audit row per due post.
   *
   * Audit-logs each transition as POST_PUBLISHED with a `scheduled: true`
   * marker so editor-driven publishes can be distinguished from automatic
   * ones in the audit trail.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduledPublish() {
    if (cronsDisabled()) return;
    // ScheduleModule runs this cron on every replica. Gate the body behind a
    // Postgres advisory lock so only ONE instance processes a given tick —
    // otherwise every replica independently flips the same due posts and calls
    // audit.writeMany, inflating the audit trail with N duplicate
    // POST_PUBLISHED rows per auto-published post.
    await withAdvisoryLock(this.prisma, ADVISORY_LOCK_KEYS.SCHEDULED_POST_PUBLISH, async () => {
      const now = new Date();
      const due = await this.prisma.posts.findMany({
        where: {
          deleted_at: null,
          is_published: false,
          published_at: { not: null, lte: now },
        },
        select: { id: true },
      });

      if (due.length === 0) return;

      this.logger.log(`Auto-publishing ${due.length} scheduled post(s)`);

      const ids = due.map((d) => d.id);
      await this.prisma.posts.updateMany({
        where: { id: { in: ids } },
        data: { is_published: true, updated_at: now },
      });

      this.audit.writeMany(
        ids.map((id) => ({
          actorId: null,
          action: AUDIT_ACTIONS.POST_PUBLISHED,
          resourceType: 'post',
          resourceId: id,
          changes: { scheduled: true, by: 'cron' },
        })),
      );
    });
  }

  /**
   * Increment the view counter for a published post — at most once per client
   * IP per post per 30 minutes (see ViewDedupService). A repeat still answers
   * with the same success response; it just does not count. The counting
   * update is a single conditional UPDATE — no SELECT-then-UPDATE race that
   * would let a soft-delete between the two queries still bump the counter.
   */
  async trackView(id: string, ip?: string) {
    const first = await this.viewDedup.claim('post', id, ip);

    if (!first) {
      // A repeat must not turn a since-deleted or unpublished post into a 200.
      const live = await this.prisma.posts.count({ where: { id, ...publicWhere(true) } });
      if (live === 0) throw new NotFoundException('Post not found');
      return { message: 'View tracked', data: null };
    }

    try {
      const result = await this.prisma.posts.updateMany({
        where: { id, ...publicWhere(true) },
        data: { views: { increment: 1 } },
      });
      if (result.count === 0) throw new NotFoundException('Post not found');
    } catch (err) {
      // Nothing was counted (unknown id, DB error): give the claim back so a
      // retry counts and a bad id leaves no dedup key behind.
      await this.viewDedup.release('post', id, ip);
      throw err;
    }
    return { message: 'View tracked', data: null };
  }

  /**
   * List soft-deleted posts (admin trash view). The suffixed slug comes
   * back stripped so the CMS can show the original slug directly.
   */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.postsWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.posts.findMany({
        where,
        select: {
          ...POST_LIST_SELECT,
          deleted_at: true,
        },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.posts.count({ where }),
    ]);

    const mapped = items.map((post) => {
      const post_translations = post.post_translations.map((t) => ({ ...t, reading_time_minutes: 0 }));
      return {
        ...post,
        slug: post.slug ? stripSoftDeleteSuffix(post.slug) : post.slug,
        post_translations,
        translation: resolveTranslation(post_translations, null),
      };
    });

    return {
      message: 'Trash fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted post. Reverses the slug-suffix trick from
   * `softDelete`. If a non-deleted post has taken the original slug in
   * the meantime, the restore is refused with 409 — the editor must
   * rename either side and retry.
   */
  async restore(id: string, userId: string) {
    const post = await this.prisma.posts.findFirst({
      where: { id, deleted_at: { not: null } },
    });
    if (!post) throw new NotFoundException('Deleted post not found');

    // The parent category may have been soft-deleted while the post sat in
    // trash (category softDelete only blocks on LIVE children). Don't restore a
    // live post under a deleted category — require the category be restored
    // first, mirroring the slug-conflict 409 below.
    const liveCategory = await this.prisma.post_categories.findFirst({
      where: { id: post.category_id, deleted_at: null },
      select: { id: true },
    });
    if (!liveCategory) {
      throw new ConflictException(
        'Cannot restore: the parent category was deleted — restore the category first',
      );
    }

    const originalSlug = post.slug ? stripSoftDeleteSuffix(post.slug) : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (originalSlug) {
          const conflict = await tx.posts.findFirst({
            where: { slug: originalSlug, deleted_at: null, NOT: { id } },
            select: { id: true },
          });
          if (conflict) {
            throw new ConflictException(`Cannot restore: slug "${originalSlug}" is now used by another post`);
          }
        }

        await tx.posts.update({
          where: { id },
          data: { deleted_at: null, updated_at: new Date(), ...(originalSlug ? { slug: originalSlug } : {}) },
        });
      });
    } catch (err) {
      // The pre-check narrows the common case, but at READ COMMITTED a
      // concurrent insert can claim the slug between the check and the
      // update. The unique constraint is the real backstop — translate its
      // P2002 into the same friendly 409 the pre-check produces.
      rethrowP2002AsConflict(err, 'Cannot restore: the original slug was claimed by another post');
    }

    this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.POST_RESTORED,
      resourceType: 'post',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/posts/${id}/restore` },
    });

    return { message: 'Post restored', data: null };
  }

  /**
   * Bulk publish / unpublish. Posts that are missing, soft-deleted, or already
   * in the target state are returned in `skipped`. The mutation now runs as at
   * most two `updateMany` calls: one for rows whose `published_at` is already
   * set, one for rows that need it stamped now. Audit rows are batched.
   *
   * The ID cap is enforced by the DTO (200).
   */
  async bulkSetPublish(dto: BulkPublishDto, userId: string) {
    const uniqueIds = Array.from(new Set(dto.ids));
    const existing = await this.prisma.posts.findMany({
      where: { id: { in: uniqueIds }, deleted_at: null },
      select: { id: true, is_published: true, published_at: true },
    });
    const existingById = new Map(existing.map((p) => [p.id, p]));

    const skipped: string[] = [];
    const idsNeedingStamp: string[] = [];
    const idsAlreadyStamped: string[] = [];
    const now = new Date();

    for (const id of uniqueIds) {
      const row = existingById.get(id);
      if (!row || row.is_published === dto.is_published) {
        skipped.push(id);
        continue;
      }
      // Publishing stamps "now" over a missing OR future date — a scheduled
      // post published early must not stay future-dated (see togglePublish).
      if (dto.is_published && (!row.published_at || row.published_at > now)) {
        idsNeedingStamp.push(id);
      } else {
        idsAlreadyStamped.push(id);
      }
    }

    const targetCount = idsNeedingStamp.length + idsAlreadyStamped.length;
    if (targetCount === 0) {
      return { message: 'No posts updated', data: { affected: 0, skipped } };
    }

    const action = dto.is_published ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_UNPUBLISHED;

    await this.prisma.$transaction(async (tx) => {
      if (idsAlreadyStamped.length > 0) {
        await tx.posts.updateMany({
          where: { id: { in: idsAlreadyStamped } },
          // Unpublishing clears published_at — see togglePublish for why.
          data: dto.is_published
            ? { is_published: true, updated_at: now }
            : { is_published: false, updated_at: now, published_at: null },
        });
      }
      if (idsNeedingStamp.length > 0) {
        await tx.posts.updateMany({
          where: { id: { in: idsNeedingStamp } },
          data: { is_published: dto.is_published, updated_at: now, published_at: now },
        });
      }
    });

    const allTargets = [...idsAlreadyStamped, ...idsNeedingStamp];
    this.audit.writeMany(
      allTargets.map((resourceId) => ({
        actorId: userId,
        action,
        resourceType: 'post',
        resourceId,
        changes: { method: 'POST', path: '/api/v1/posts/bulk/publish', is_published: dto.is_published, bulk: true },
      })),
    );

    return {
      message: `${targetCount} post(s) ${dto.is_published ? 'published' : 'unpublished'}`,
      data: { affected: targetCount, skipped },
    };
  }

  /**
   * Bulk soft-delete. Slug suffixing is a single raw UPDATE on `posts`
   * (one query, regardless of batch size); the deletion flag flip is a
   * single updateMany. Already-deleted or missing ids are returned in
   * `skipped`.
   */
  async bulkDelete(dto: BulkIdsDto, userId: string) {
    const uniqueIds = Array.from(new Set(dto.ids));
    const existing = await this.prisma.posts.findMany({
      where: { id: { in: uniqueIds }, deleted_at: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((p) => p.id));

    const skipped = uniqueIds.filter((id) => !existingIds.has(id));
    const targetIds = uniqueIds.filter((id) => existingIds.has(id));

    if (targetIds.length === 0) {
      return { message: 'No posts deleted', data: { affected: 0, skipped } };
    }

    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      // Single raw UPDATE suffixes every post's slug across the batch in one
      // DB round-trip instead of N findMany + M updates.
      await tx.$executeRaw`
        UPDATE posts
        SET slug = slug || ${suffix}
        WHERE id = ANY(${targetIds}::uuid[])
      `;
      await tx.posts.updateMany({
        where: { id: { in: targetIds } },
        data: { deleted_at: deletedAt },
      });
    });

    this.audit.writeMany(
      targetIds.map((resourceId) => ({
        actorId: userId,
        action: AUDIT_ACTIONS.POST_DELETED,
        resourceType: 'post',
        resourceId,
        changes: { method: 'POST', path: '/api/v1/posts/bulk/delete', bulk: true },
      })),
    );

    return {
      message: `${targetIds.length} post(s) deleted`,
      data: { affected: targetIds.length, skipped },
    };
  }

  async softDelete(id: string, userId: string) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null } });
    if (!post) throw new NotFoundException('Post not found');

    // Free up the slug's unique constraint by suffixing it with a marker
    // that points back to the deletion. Without this, a soft-deleted post's
    // slug stays reserved forever. Restore strips the suffix back off (see
    // `restore`).
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.posts.update({
      where: { id },
      data: { deleted_at: deletedAt, ...(post.slug ? { slug: `${post.slug}${suffix}` } : {}) },
    });

    this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.POST_DELETED,
      resourceType: 'post',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/posts/${id}` },
    });

    return { message: 'Post deleted', data: null };
  }
}
