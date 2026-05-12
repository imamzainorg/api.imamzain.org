import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { readingTimeMinutes } from '../common/utils/reading-time.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { BulkIdsDto, BulkPublishDto, CreatePostDto, PostQueryDto, PostSort, PostStatus, TogglePublishDto, UpdatePostDto } from './dto/post.dto';

/** Decorate a translation row with the derived `reading_time_minutes`. */
function withReadingTime<T extends { body?: string | null }>(t: T): T & { reading_time_minutes: number } {
  return { ...t, reading_time_minutes: readingTimeMinutes(t.body ?? null) };
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PostQueryDto, lang: string | null, isAdmin = false) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
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

    const [items, total] = await Promise.all([
      this.prisma.posts.findMany({
        where,
        include: {
          post_translations: true,
          post_categories: { include: { post_category_translations: true } },
          media: true,
          post_attachments: {
            take: 1,
            include: { media: true },
            orderBy: { display_order: 'asc' },
          },
        },
        orderBy:
          query.sort === PostSort.Views
            ? [{ views: 'desc' }, { id: 'asc' }]
            : [{ published_at: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.posts.count({ where }),
    ]);

    const mapped = items.map((post) => {
      const decorated = post.post_translations.map(withReadingTime);
      return {
        ...post,
        post_translations: decorated,
        translation: resolveTranslation(decorated, lang),
      };
    });

    return {
      message: 'Posts fetched',
      data: { items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string, lang: string | null, isAdmin = false) {
    const where: any = { id, deleted_at: null };
    if (!isAdmin) where.is_published = true;

    const post = await this.prisma.posts.findFirst({
      where,
      include: {
        post_translations: true,
        post_categories: { include: { post_category_translations: true } },
        media: true,
        post_attachments: { include: { media: true }, orderBy: { display_order: 'asc' } },
      },
    });

    if (!post) throw new NotFoundException('Post not found');

    const decorated = post.post_translations.map(withReadingTime);

    return {
      message: 'Post fetched',
      data: { ...post, post_translations: decorated, translation: resolveTranslation(decorated, lang) },
    };
  }

  async findBySlug(slug: string, lang: string | null) {
    const where: any = { slug, posts: { deleted_at: null, is_published: true } };
    if (lang) where.lang = lang;

    const translation = await this.prisma.post_translations.findFirst({ where });
    if (!translation) throw new NotFoundException('Post not found');

    return this.findOne(translation.post_id, lang);
  }

  async create(dto: CreatePostDto, userId: string) {
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
      const found = await this.prisma.media.count({ where: { id: { in: ogImageIds } } });
      if (found !== new Set(ogImageIds).size) {
        throw new NotFoundException('One or more og_image_id values do not match any media record');
      }
    }

    const defaultCount = dto.translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) {
      throw new BadRequestException('Exactly one translation must have is_default: true');
    }

    const post = await this.prisma.$transaction(async (tx) => {
      // Pre-check slug availability inside the transaction so duplicate slugs
      // surface as 409 with a useful message instead of a Prisma P2002 500.
      for (const t of dto.translations) {
        const conflict = await tx.post_translations.findFirst({
          where: { lang: t.lang, slug: t.slug },
        });
        if (conflict) {
          throw new ConflictException(`Slug "${t.slug}" is already in use for language ${t.lang}`);
        }
      }

      const created = await tx.posts.create({
        data: {
          category_id: dto.category_id,
          cover_image_id: dto.cover_image_id ?? null,
          is_published: dto.is_published ?? false,
          is_featured: dto.is_featured ?? false,
          published_at: dto.published_at ? new Date(dto.published_at) : null,
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'POST_CREATED',
          resource_type: 'post',
          resource_id: post.id,
          changes: { method: 'POST', path: '/api/v1/posts' },
        },
      });
    } catch {}

    return { message: 'Post created', data: post };
  }

  async update(id: string, dto: UpdatePostDto, userId: string) {
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
        const found = await this.prisma.media.count({ where: { id: { in: ogImageIds } } });
        if (found !== new Set(ogImageIds).size) {
          throw new NotFoundException('One or more og_image_id values do not match any media record');
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const updateData: any = { updated_at: new Date() };
      if (dto.category_id !== undefined) updateData.category_id = dto.category_id;
      if (dto.cover_image_id !== undefined) updateData.cover_image_id = dto.cover_image_id;
      if (dto.is_published !== undefined) updateData.is_published = dto.is_published;
      if (dto.is_featured !== undefined) updateData.is_featured = dto.is_featured;
      if (dto.published_at !== undefined) {
        updateData.published_at = dto.published_at ? new Date(dto.published_at) : null;
      }

      await tx.posts.update({ where: { id }, data: updateData });

      if (dto.translations) {
        for (const t of dto.translations) {
          // Slug collision check (skip same row).
          const conflict = await tx.post_translations.findFirst({
            where: {
              lang: t.lang,
              slug: t.slug,
              NOT: { post_id: id },
            },
          });
          if (conflict) {
            throw new ConflictException(`Slug "${t.slug}" is already in use for language ${t.lang}`);
          }

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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'POST_UPDATED',
          resource_type: 'post',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/posts/${id}` },
        },
      });
    } catch {}

    return { message: 'Post updated', data: null };
  }

  async togglePublish(id: string, dto: TogglePublishDto, userId: string) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null } });
    if (!post) throw new NotFoundException('Post not found');

    const updateData: any = { is_published: dto.is_published, updated_at: new Date() };
    if (dto.is_published && !post.published_at) {
      updateData.published_at = new Date();
    }

    await this.prisma.posts.update({ where: { id }, data: updateData });

    const action = dto.is_published ? 'POST_PUBLISHED' : 'POST_UNPUBLISHED';

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action,
          resource_type: 'post',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/posts/${id}/publish`, is_published: dto.is_published },
        },
      });
    } catch {}

    return { message: `Post ${dto.is_published ? 'published' : 'unpublished'}`, data: null };
  }

  /**
   * Auto-publish posts whose `published_at` has arrived.
   *
   * Editors set a future `published_at` and leave `is_published=false`; this
   * cron flips them to `is_published=true` once the timestamp is reached.
   * Runs every minute — cheap query (indexed on deleted_at + is_published)
   * with a tight WHERE clause.
   *
   * Audit-logs each transition as POST_PUBLISHED with a `scheduled: true`
   * marker so editor-driven publishes can be distinguished from automatic
   * ones in the audit trail.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduledPublish() {
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

    for (const { id } of due) {
      try {
        await this.prisma.$transaction([
          this.prisma.posts.update({
            where: { id },
            data: { is_published: true, updated_at: now },
          }),
          this.prisma.audit_logs.create({
            data: {
              user_id: null,
              action: 'POST_PUBLISHED',
              resource_type: 'post',
              resource_id: id,
              changes: { scheduled: true, by: 'cron' },
            },
          }),
        ]);
      } catch (err) {
        this.logger.warn(`Scheduled publish failed for post ${id}: ${err}`);
      }
    }
  }

  async trackView(id: string) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null, is_published: true } });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.posts.update({ where: { id }, data: { views: { increment: 1 } } });
    return { message: 'View tracked', data: null };
  }

  /**
   * List soft-deleted posts (admin trash view). Translations and the
   * suffixed slug come back as-is so the CMS can show the original slug
   * by stripping `__del_<timestamp>` client-side if needed.
   */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.posts.findMany({
        where,
        include: {
          post_translations: true,
          post_categories: { include: { post_category_translations: true } },
        },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.posts.count({ where }),
    ]);

    const mapped = items.map((post) => ({
      ...post,
      // Show the original slug in the response so the CMS doesn't have to
      // strip the suffix itself when listing trash.
      post_translations: post.post_translations.map((t) => ({
        ...t,
        slug: stripSoftDeleteSuffix(t.slug),
      })),
    }));

    return {
      message: 'Trash fetched',
      data: { items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
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

    const restoredSlugs = post.post_translations.map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    await this.prisma.$transaction(async (tx) => {
      // Conflict-check each (lang, original_slug) against live rows before
      // any update — a single conflict aborts the whole restore.
      for (const { lang, original } of restoredSlugs) {
        const conflict = await tx.post_translations.findFirst({
          where: { lang, slug: original, NOT: { post_id: id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Cannot restore: slug "${original}" (${lang}) is now used by another post`,
          );
        }
      }

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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'POST_RESTORED',
          resource_type: 'post',
          resource_id: id,
          changes: { method: 'POST', path: `/api/v1/posts/${id}/restore` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write POST_RESTORED audit: ${err}`);
    }

    return { message: 'Post restored', data: null };
  }

  /**
   * Bulk publish / unpublish. Iterates the requested ids, applies the same
   * `togglePublish` semantics per row (auto-fill `published_at` on first
   * publish), and audit-logs each transition. Posts that are missing,
   * soft-deleted, or already in the target state are returned in
   * `skipped` so the CMS can show "8 published, 2 already published".
   *
   * The whole batch runs inside a single transaction — partial failure
   * rolls back every row. ID cap is enforced by the DTO (200).
   */
  async bulkSetPublish(dto: BulkPublishDto, userId: string) {
    const uniqueIds = Array.from(new Set(dto.ids));
    const existing = await this.prisma.posts.findMany({
      where: { id: { in: uniqueIds }, deleted_at: null },
      select: { id: true, is_published: true, published_at: true },
    });
    const existingById = new Map(existing.map((p) => [p.id, p]));

    const skipped: string[] = [];
    const targets: Array<{ id: string; published_at: Date | null }> = [];

    for (const id of uniqueIds) {
      const row = existingById.get(id);
      if (!row || row.is_published === dto.is_published) {
        skipped.push(id);
        continue;
      }
      targets.push({ id, published_at: row.published_at });
    }

    if (targets.length === 0) {
      return { message: 'No posts updated', data: { affected: 0, skipped } };
    }

    const now = new Date();
    const action = dto.is_published ? 'POST_PUBLISHED' : 'POST_UNPUBLISHED';

    await this.prisma.$transaction(async (tx) => {
      for (const t of targets) {
        const data: any = { is_published: dto.is_published, updated_at: now };
        if (dto.is_published && !t.published_at) data.published_at = now;
        await tx.posts.update({ where: { id: t.id }, data });
        await tx.audit_logs.create({
          data: {
            user_id: userId,
            action,
            resource_type: 'post',
            resource_id: t.id,
            changes: { method: 'POST', path: '/api/v1/posts/bulk/publish', is_published: dto.is_published, bulk: true },
          },
        });
      }
    });

    return {
      message: `${targets.length} post(s) ${dto.is_published ? 'published' : 'unpublished'}`,
      data: { affected: targets.length, skipped },
    };
  }

  /**
   * Bulk soft-delete. Same per-row semantics as `softDelete` (suffix every
   * translation slug to free the unique constraint, audit-log each row).
   * Already-deleted or missing ids are returned in `skipped`.
   *
   * Slug suffixing has to be a per-row update because each translation row
   * holds its own slug; we loop within a single transaction so the cost
   * scales linearly with the batch size but the whole batch is atomic.
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
      for (const id of targetIds) {
        const translations = await tx.post_translations.findMany({ where: { post_id: id } });
        for (const t of translations) {
          await tx.post_translations.update({
            where: { post_id_lang: { post_id: id, lang: t.lang } },
            data: { slug: `${t.slug}${suffix}` },
          });
        }
        await tx.posts.update({ where: { id }, data: { deleted_at: deletedAt } });
        await tx.audit_logs.create({
          data: {
            user_id: userId,
            action: 'POST_DELETED',
            resource_type: 'post',
            resource_id: id,
            changes: { method: 'POST', path: '/api/v1/posts/bulk/delete', bulk: true },
          },
        });
      }
    });

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
      const translations = await tx.post_translations.findMany({ where: { post_id: id } });
      for (const t of translations) {
        await tx.post_translations.update({
          where: { post_id_lang: { post_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await tx.posts.update({ where: { id }, data: { deleted_at: deletedAt } });
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'POST_DELETED',
          resource_type: 'post',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/posts/${id}` },
        },
      });
    } catch {}

    return { message: 'Post deleted', data: null };
  }
}
