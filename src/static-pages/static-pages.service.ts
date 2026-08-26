import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { assertExactlyOneDefault, resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { publicWhere } from '../common/utils/visibility.util';
import { OG_IMAGE_SELECT } from '../common/crud/media-selects';
import {
  CreateStaticPageDto,
  StaticPageQueryDto,
  TogglePublishStaticPageDto,
  UpdateStaticPageDto,
} from './dto/static-page.dto';

@Injectable()
export class StaticPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public list: published pages only, ordered by display_order then id. */
  async findAllPublic(lang: string | null, pageInput: number, limitInput: number) {
    const { page, limit, skip } = resolvePagination({ page: pageInput, limit: limitInput });
    const where: Prisma.static_pagesWhereInput = publicWhere(true);
    const [pages, total] = await Promise.all([
      this.prisma.static_pages.findMany({
        where,
        include: { static_page_translations: true },
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.static_pages.count({ where }),
    ]);
    const items = pages.map((p) => ({
      ...p,
      translation: resolveTranslation(p.static_page_translations, lang),
    }));
    return { message: 'Static pages fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** Admin list: includes drafts; optional `is_published` filter. */
  async findAllAdmin(lang: string | null, query: StaticPageQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.static_pagesWhereInput = { deleted_at: null };
    if (query.is_published !== undefined) where.is_published = query.is_published;
    const [pages, total] = await Promise.all([
      this.prisma.static_pages.findMany({
        where,
        include: { static_page_translations: true },
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.static_pages.count({ where }),
    ]);
    const items = pages.map((p) => ({
      ...p,
      translation: resolveTranslation(p.static_page_translations, lang),
    }));
    return { message: 'Static pages fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Fetch a single page by id. Public callers (default) only ever see published
   * pages — an unpublished draft must not be readable just because its UUID is
   * known. Admin/CMS callers and the service's own post-write reads pass
   * `allowUnpublished` so a freshly-created or unpublished draft still resolves.
   */
  async findOne(id: string, lang: string | null, opts: { allowUnpublished?: boolean } = {}) {
    const where: Prisma.static_pagesWhereInput = { id, deleted_at: null };
    if (!opts.allowUnpublished) where.is_published = true;
    const page = await this.prisma.static_pages.findFirst({
      where,
      include: { static_page_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } } },
    });
    if (!page) throw new NotFoundException('Static page not found');
    return {
      message: 'Static page fetched',
      data: { ...page, translation: resolveTranslation(page.static_page_translations, lang) },
    };
  }

  /** Public detail by canonical slug — one language-agnostic slug per page. */
  async findBySlug(slug: string, lang: string | null) {
    const page = await this.prisma.static_pages.findFirst({
      where: { slug, ...publicWhere(true) },
      include: { static_page_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } } },
    });
    if (!page) throw new NotFoundException('Static page not found');

    return {
      message: 'Static page fetched',
      data: { ...page, translation: resolveTranslation(page.static_page_translations, lang) },
    };
  }

  /** Reject a slug that collides with another live static page's slug. */
  private async assertSlugAvailable(slug: string, excludePageId: string | null) {
    const conflict = await this.prisma.static_pages.findFirst({
      where: { slug, ...(excludePageId ? { NOT: { id: excludePageId } } : {}) },
      select: { id: true },
    });
    if (conflict) throw new ConflictException(`Slug "${slug}" is already used by another static page`);
  }

  async create(dto: CreateStaticPageDto, actorId: string) {
    await this.assertSlugAvailable(dto.slug, null);
    assertExactlyOneDefault(dto.translations);

    const translations = dto.translations.map((t) => ({
      ...t,
      body: sanitizeEditorHtml(t.body),
    }));

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.static_pages.create({
          data: {
            slug: dto.slug,
            display_order: dto.display_order ?? 0,
            is_published: dto.is_published ?? true,
          },
        });
        await tx.static_page_translations.createMany({
          data: translations.map((t) => ({
            page_id: row.id,
            lang: t.lang,
            title: t.title,
            body: t.body,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
            is_default: t.is_default ?? false,
          })),
        });
        return row;
      });
    } catch (err) {
      rethrowP2002AsConflict(err, `Slug "${dto.slug}" is already used by another static page`);
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STATIC_PAGE_CREATED,
      resourceType: 'static_page',
      resourceId: created.id,
      changes: { method: 'POST', path: '/api/v1/static-pages' },
    });

    const { data } = await this.findOne(created.id, null, { allowUnpublished: true });
    return { message: 'Static page created', data };
  }

  async update(id: string, dto: UpdateStaticPageDto, actorId: string) {
    const existing = await this.prisma.static_pages.findFirst({ where: { id, deleted_at: null } });
    if (!existing) throw new NotFoundException('Static page not found');

    if (dto.slug !== undefined) await this.assertSlugAvailable(dto.slug, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        const scalarPatch: Prisma.static_pagesUpdateInput = { updated_at: new Date() };
        if (dto.slug !== undefined) scalarPatch.slug = dto.slug;
        if (dto.display_order !== undefined) scalarPatch.display_order = dto.display_order;
        if (dto.is_published !== undefined) scalarPatch.is_published = dto.is_published;
        if (Object.keys(scalarPatch).length > 1) {
          await tx.static_pages.update({ where: { id }, data: scalarPatch });
        }

        if (dto.translations && dto.translations.length > 0) {
          for (const t of dto.translations) {
            const trData = {
              title: t.title,
              body: sanitizeEditorHtml(t.body),
              meta_title: t.meta_title ?? null,
              meta_description: t.meta_description ?? null,
              og_image_id: t.og_image_id ?? null,
              is_default: t.is_default ?? false,
            };
            await tx.static_page_translations.upsert({
              where: { page_id_lang: { page_id: id, lang: t.lang } },
              create: { page_id: id, lang: t.lang, ...trData },
              update: trData,
            });
          }

          // Re-assert the single-default invariant once all upserts have landed
          // (matches posts/books): a partial update that flips is_default on
          // one row must not leave the page with 0 or 2+ defaults across the
          // full translation set, not just the rows in this request.
          const defaults = await tx.static_page_translations.count({
            where: { page_id: id, is_default: true },
          });
          if (defaults !== 1) {
            throw new BadRequestException('Exactly one translation must have is_default: true');
          }
        }
      });
    } catch (err) {
      rethrowP2002AsConflict(err, `Slug "${dto.slug}" is already used by another static page`);
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STATIC_PAGE_UPDATED,
      resourceType: 'static_page',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/static-pages/${id}` },
    });

    const { data } = await this.findOne(id, null, { allowUnpublished: true });
    return { message: 'Static page updated', data };
  }

  async togglePublish(id: string, dto: TogglePublishStaticPageDto, actorId: string) {
    const existing = await this.prisma.static_pages.findFirst({ where: { id, deleted_at: null } });
    if (!existing) throw new NotFoundException('Static page not found');

    if (existing.is_published === dto.is_published) {
      const { data } = await this.findOne(id, null, { allowUnpublished: true });
      return { message: 'Static page already in requested state', data };
    }

    await this.prisma.static_pages.update({
      where: { id },
      data: { is_published: dto.is_published, updated_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: dto.is_published ? AUDIT_ACTIONS.STATIC_PAGE_PUBLISHED : AUDIT_ACTIONS.STATIC_PAGE_UNPUBLISHED,
      resourceType: 'static_page',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/static-pages/${id}/publish`, is_published: dto.is_published },
    });

    const { data } = await this.findOne(id, null, { allowUnpublished: true });
    return { message: dto.is_published ? 'Static page published' : 'Static page unpublished', data };
  }

  /** List soft-deleted static pages with original slugs (suffix stripped). */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.static_pagesWhereInput = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.static_pages.findMany({
        where,
        include: { static_page_translations: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.static_pages.count({ where }),
    ]);
    const items = rows.map((row) => ({
      ...row,
      slug: stripSoftDeleteSuffix(row.slug),
      translation: resolveTranslation(row.static_page_translations, null),
    }));
    return {
      message: 'Trash fetched',
      data: { items, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted page. Reverses the slug-suffix trick from
   * softDelete; refused with 409 if a live page has taken the original slug
   * since the delete — operator must rename one side and retry.
   */
  async restore(id: string, actorId: string) {
    const page = await this.prisma.static_pages.findFirst({
      where: { id, deleted_at: { not: null } },
    });
    if (!page) throw new NotFoundException('Deleted static page not found');

    const originalSlug = stripSoftDeleteSuffix(page.slug);

    try {
      await this.prisma.$transaction(async (tx) => {
        const conflict = await tx.static_pages.findFirst({
          where: { slug: originalSlug, deleted_at: null, NOT: { id } },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException(`Cannot restore: slug "${originalSlug}" is now used by another static page`);
        }

        await tx.static_pages.update({
          where: { id },
          data: { deleted_at: null, updated_at: new Date(), slug: originalSlug },
        });
      });
    } catch (err) {
      // The pre-check above narrows the common case, but at READ COMMITTED a
      // concurrent insert can still claim the slug between the check and the
      // update — the DB unique constraint is the real backstop. Translate
      // that raw P2002 into the same friendly 409.
      rethrowP2002AsConflict(err, 'Cannot restore: the original slug was claimed by another static page');
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STATIC_PAGE_RESTORED,
      resourceType: 'static_page',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/static-pages/${id}/restore` },
    });

    return { message: 'Static page restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const page = await this.prisma.static_pages.findFirst({ where: { id, deleted_at: null } });
    if (!page) throw new NotFoundException('Static page not found');

    // Free the slug's unique constraint by suffixing it so a new page can
    // claim it while this one sits in trash. Restore reverses the suffix.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.static_pages.update({
      where: { id },
      data: { deleted_at: deletedAt, slug: `${page.slug}${suffix}` },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STATIC_PAGE_DELETED,
      resourceType: 'static_page',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/static-pages/${id}` },
    });

    return { message: 'Static page deleted', data: null };
  }
}
