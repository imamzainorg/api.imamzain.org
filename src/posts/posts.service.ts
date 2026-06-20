import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { readingTimeMinutes } from '../common/utils/reading-time.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../common/utils/advisory-lock.util';
import { BulkIdsDto, BulkPublishDto, CreatePostDto, PostQueryDto, PostSort, PostStatus, TogglePublishDto, UpdatePostDto } from './dto/post.dto';

// Public media variant shape — enough for the public site's `<img srcset>`.
// Kept slim (no file_size / created_at) so it's cheap to ship on list payloads.
const MEDIA_VARIANT_SELECT = {
  id: true,
  width: true,
  url: true,
  format: true,
} satisfies Prisma.media_variantsSelect;

// Resolvable per-translation OG image for SEO meta tags. The detail endpoint
// hydrates this from `og_image_id` so the front-end gets a usable URL, not a
// bare UUID it can't resolve.
const OG_IMAGE_SELECT = {
  id: true,
  url: true,
  filename: true,
  alt_text: true,
  mime_type: true,
  width: true,
  height: true,
} satisfies Prisma.mediaSelect;

const POST_DETAIL_INCLUDE = {
  post_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
  post_categories: { include: { post_category_translations: true } },
  media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } },
  post_attachments: {
    include: { media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } } },
    orderBy: { display_order: 'asc' },
  },
} satisfies Prisma.postsInclude;

// List queries drop the full `body` from translations (typically 5-50 KB of
// HTML each, multiplied by N translations × page size) and collapse the
// category's full translation array to a single resolved row. Detail still
// returns everything.
const POST_LIST_TRANSLATION_SELECT = {
  post_id: true,
  lang: true,
  title: true,
  summary: true,
  slug: true,
  is_default: true,
  meta_title: true,
  meta_description: true,
  og_image_id: true,
} satisfies Prisma.post_translationsSelect;

const POST_LIST_SELECT = {
  id: true,
  category_id: true,
  cover_image_id: true,
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
  media: {
    select: {
      id: true,
      url: true,
      filename: true,
      alt_text: true,
      mime_type: true,
      width: true,
      height: true,
      media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } },
    },
  },
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

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

    const post = await this.prisma.posts.findFirst({ where, include: POST_DETAIL_INCLUDE });

    if (!post) throw new NotFoundException('Post not found');

    const decorated = post.post_translations.map(withReadingTime);

    return {
      message: 'Post fetched',
      data: { ...post, post_translations: decorated, translation: resolveTranslation(decorated, lang) },
    };
  }

  async findBySlug(slug: string, lang: string | null) {
    // A slug is unique per language (@@unique([lang, slug])); the same slug
    // string can belong to one post in each language. Look it up by slug and
    // prefer the requested language when it has a row for this slug, but never
    // 404 just because the visitor's Accept-Language differs from the slug's
    // own language — the canonical page must resolve in any locale. (The
    // payload's display translation is still resolved per `lang` below.)
    const baseWhere: Prisma.post_translationsWhereInput = {
      slug,
      posts: { deleted_at: null, is_published: true },
    };

    let translation = lang
      ? await this.prisma.post_translations.findFirst({
          where: { ...baseWhere, lang },
          include: { posts: { include: POST_DETAIL_INCLUDE } },
        })
      : null;

    if (!translation) {
      translation = await this.prisma.post_translations.findFirst({
        where: baseWhere,
        orderBy: { lang: 'asc' },
        include: { posts: { include: POST_DETAIL_INCLUDE } },
      });
    }

    if (!translation || !translation.posts) throw new NotFoundException('Post not found');

    const post = translation.posts;
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

    // Validate every translation-level og_image_id up front so a bad one
    // surfaces as 404 with a useful message instead of a Prisma FK error.
    const ogImageIds = dto.translations
      .map((t) => t.og_image_id)
      .filter((v): v is string => typeof v === 'string');
    if (ogImageIds.length > 0) {
      const found = await this.prisma.media.findMany({
        where: { id: { in: ogImageIds } },
        select: { id: true },
      });
      if (found.length !== new Set(ogImageIds).size) {
        throw new NotFoundException('One or more og_image_id values do not match any media record');
      }
    }

    const defaultCount = dto.translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) {
      throw new BadRequestException('Exactly one translation must have is_default: true');
    }

    // Batched pre-check: one findMany covers every (lang, slug) up front so
    // duplicate slugs surface as a useful 409 instead of N sequential queries
    // followed by a P2002 from createMany.
    await this.assertSlugsAvailable(this.prisma, dto.translations.map((t) => ({ lang: t.lang, slug: t.slug })));

    // Stamp published_at when a post is created already-published without an
    // explicit timestamp. A published post with published_at = NULL sorts
    // NULLS FIRST under `ORDER BY published_at DESC` (the public list, homepage
    // and RSS feed all use it), pinning it to the top of every list forever.
    const isPublished = dto.is_published ?? false;
    const publishedAt = dto.published_at
      ? new Date(dto.published_at)
      : isPublished
        ? new Date()
        : null;

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.posts.create({
        data: {
          category_id: dto.category_id,
          cover_image_id: dto.cover_image_id ?? null,
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
          slug: t.slug,
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

    if (dto.translations) {
      const ogImageIds = dto.translations
        .map((t) => t.og_image_id)
        .filter((v): v is string => typeof v === 'string');
      if (ogImageIds.length > 0) {
        const found = await this.prisma.media.findMany({
          where: { id: { in: ogImageIds } },
          select: { id: true },
        });
        if (found.length !== new Set(ogImageIds).size) {
          throw new NotFoundException('One or more og_image_id values do not match any media record');
        }
      }

      await this.assertSlugsAvailable(
        this.prisma,
        dto.translations.map((t) => ({ lang: t.lang, slug: t.slug })),
        id,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.postsUpdateInput = { updated_at: new Date() };
      if (dto.category_id !== undefined) updateData.post_categories = { connect: { id: dto.category_id } };
      if (dto.cover_image_id !== undefined) {
        updateData.media = dto.cover_image_id
          ? { connect: { id: dto.cover_image_id } }
          : { disconnect: true };
      }
      if (dto.is_published !== undefined) updateData.is_published = dto.is_published;
      if (dto.is_featured !== undefined) updateData.is_featured = dto.is_featured;
      if (dto.published_at !== undefined) {
        updateData.published_at = dto.published_at ? new Date(dto.published_at) : null;
      }

      // Stamp published_at = now when the post is (or is becoming) published
      // but would still have no timestamp — otherwise it sorts NULLS FIRST and
      // pins to the top of every public list/feed forever. (togglePublish
      // already stamps; create/update previously did not.)
      const willBePublished = dto.is_published ?? post.is_published;
      const resolvedPublishedAt =
        dto.published_at !== undefined
          ? dto.published_at
            ? new Date(dto.published_at)
            : null
          : post.published_at;
      if (willBePublished && resolvedPublishedAt === null) {
        updateData.published_at = new Date();
      }

      await tx.posts.update({ where: { id }, data: updateData });

      if (dto.translations) {
        for (const t of dto.translations) {
          const cleanBody = sanitizeEditorHtml(t.body);
          const translationData = {
            title: t.title,
            summary: t.summary ?? null,
            body: cleanBody,
            slug: t.slug,
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
   * Single batched (lang, slug) availability check. One findMany replaces the
   * per-translation findFirst loops that used to run inside the transaction.
   * Pass `excludePostId` to skip rows that already belong to the post being
   * updated (otherwise an unchanged slug would self-conflict).
   */
  private async assertSlugsAvailable(
    db: PrismaService | Prisma.TransactionClient,
    pairs: Array<{ lang: string; slug: string }>,
    excludePostId?: string,
  ): Promise<void> {
    if (pairs.length === 0) return;
    const where: Prisma.post_translationsWhereInput = {
      OR: pairs.map((p) => ({ lang: p.lang, slug: p.slug })),
    };
    if (excludePostId) where.NOT = { post_id: excludePostId };
    const conflicts = await db.post_translations.findMany({
      where,
      select: { lang: true, slug: true },
    });
    if (conflicts.length > 0) {
      const first = conflicts[0];
      throw new ConflictException(`Slug "${first.slug}" is already in use for language ${first.lang}`);
    }
  }

  async togglePublish(id: string, dto: TogglePublishDto, userId: string, lang: string | null) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null } });
    if (!post) throw new NotFoundException('Post not found');

    const updateData: Prisma.postsUpdateInput = { is_published: dto.is_published, updated_at: new Date() };
    if (dto.is_published && !post.published_at) {
      updateData.published_at = new Date();
    }

    await this.prisma.posts.update({ where: { id }, data: updateData });

    const action = dto.is_published ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_UNPUBLISHED;
    this.audit.write({
      actorId: userId,
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
   * Increment the view counter for a published post. Single conditional
   * update — no SELECT-then-UPDATE race that would let a soft-delete between
   * the two queries still bump the counter.
   */
  async trackView(id: string) {
    const result = await this.prisma.posts.updateMany({
      where: { id, deleted_at: null, is_published: true },
      data: { views: { increment: 1 } },
    });
    if (result.count === 0) throw new NotFoundException('Post not found');
    return { message: 'View tracked', data: null };
  }

  /**
   * List soft-deleted posts (admin trash view). Translations and the
   * suffixed slug come back as-is so the CMS can show the original slug
   * by stripping `__del_<timestamp>` client-side if needed.
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
      const post_translations = post.post_translations.map((t) => ({
        ...t,
        slug: stripSoftDeleteSuffix(t.slug),
        reading_time_minutes: 0,
      }));
      return {
        ...post,
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
      include: { post_translations: true },
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

    const restoredSlugs = post.post_translations.map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    try {
      await this.prisma.$transaction(async (tx) => {
        // Single batched conflict-check across every (lang, original_slug).
        const conflicts = await tx.post_translations.findMany({
          where: {
            OR: restoredSlugs.map(({ lang, original }) => ({ lang, slug: original })),
            NOT: { post_id: id },
          },
          select: { lang: true, slug: true },
        });
        if (conflicts.length > 0) {
          const first = conflicts[0];
          throw new ConflictException(
            `Cannot restore: slug "${first.slug}" (${first.lang}) is now used by another post`,
          );
        }

        // Per-row updates: each translation's slug needs the suffix stripped to
        // its own value. Prisma has no `update column = func(column)` shorthand;
        // a raw query would work but loses the type safety the upserts give us.
        for (const { lang, original } of restoredSlugs) {
          await tx.post_translations.update({
            where: { post_id_lang: { post_id: id, lang } },
            data: { slug: original },
          });
        }

        await tx.posts.update({
          where: { id },
          data: { deleted_at: null, updated_at: new Date() },
        });
      });
    } catch (err) {
      // The batched pre-check narrows the common case, but at READ COMMITTED a
      // concurrent insert can claim one of the (lang, slug) pairs between the
      // check and the update. The unique constraint is the real backstop —
      // translate its P2002 into the same friendly 409 the pre-check produces.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Cannot restore: one of the original translation slugs was claimed by another post',
        );
      }
      throw err;
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

    for (const id of uniqueIds) {
      const row = existingById.get(id);
      if (!row || row.is_published === dto.is_published) {
        skipped.push(id);
        continue;
      }
      if (dto.is_published && !row.published_at) {
        idsNeedingStamp.push(id);
      } else {
        idsAlreadyStamped.push(id);
      }
    }

    const targetCount = idsNeedingStamp.length + idsAlreadyStamped.length;
    if (targetCount === 0) {
      return { message: 'No posts updated', data: { affected: 0, skipped } };
    }

    const now = new Date();
    const action = dto.is_published ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_UNPUBLISHED;

    await this.prisma.$transaction(async (tx) => {
      if (idsAlreadyStamped.length > 0) {
        await tx.posts.updateMany({
          where: { id: { in: idsAlreadyStamped } },
          data: { is_published: dto.is_published, updated_at: now },
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
   * Bulk soft-delete. Slug suffixing is done as a single raw UPDATE per
   * translation table (one query, regardless of batch size); the deletion
   * flag flip is a single updateMany on `posts`. Already-deleted or missing
   * ids are returned in `skipped`.
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
      // Single raw UPDATE suffixes every translation slug across the batch in
      // one DB round-trip instead of N findMany + M updates.
      await tx.$executeRaw`
        UPDATE post_translations
        SET slug = slug || ${suffix}
        WHERE post_id = ANY(${targetIds}::uuid[])
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

    // Free up the (lang, slug) unique constraint by suffixing each translation
    // slug with a marker that points back to the deletion. Without this, a
    // soft-deleted post's slug stays reserved forever. Restore strips the
    // suffix back off (see `restore`).
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE post_translations
        SET slug = slug || ${suffix}
        WHERE post_id = ${id}::uuid
      `;
      await tx.posts.update({ where: { id }, data: { deleted_at: deletedAt } });
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
