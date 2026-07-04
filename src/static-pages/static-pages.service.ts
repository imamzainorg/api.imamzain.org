import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import {
  CreateStaticPageDto,
  StaticPageQueryDto,
  TogglePublishStaticPageDto,
  UpdateStaticPageDto,
} from './dto/static-page.dto';

// Resolvable per-translation OG image for SEO meta tags (detail only).
const OG_IMAGE_SELECT = {
  id: true,
  url: true,
  filename: true,
  alt_text: true,
  mime_type: true,
  width: true,
  height: true,
} satisfies Prisma.mediaSelect;

@Injectable()
export class StaticPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Apply the project's `is_default` invariant — exactly one translation per
   * resource carries the flag, and it's the fallback resolveTranslation uses
   * when the requested lang has no row. If the caller didn't set one, pin it
   * to the first translation so the row is never stranded with all-false.
   */
  private normaliseDefaults<T extends { is_default?: boolean }>(translations: T[]): T[] {
    const explicit = translations.find((t) => t.is_default === true);
    if (explicit) {
      return translations.map((t) => ({ ...t, is_default: t === explicit }));
    }
    return translations.map((t, i) => ({ ...t, is_default: i === 0 }));
  }

  /** Public list: published pages only, ordered by display_order then id. */
  async findAllPublic(lang: string | null, pageInput: number, limitInput: number) {
    const { page, limit, skip } = resolvePagination({ page: pageInput, limit: limitInput });
    const where: Prisma.static_pagesWhereInput = { deleted_at: null, is_published: true };
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

  /**
   * Public slug lookup. A slug is unique per language; the same slug string can
   * belong to one page in each language. Prefer the requested language when it
   * has a row for this slug, otherwise return the page that owns the slug in
   * any language — the canonical page must resolve regardless of the visitor's
   * Accept-Language. The display translation is still resolved per `lang`.
   */
  async findBySlug(slug: string, lang: string | null) {
    const baseWhere: Prisma.static_page_translationsWhereInput = {
      slug,
      static_pages: { deleted_at: null, is_published: true },
    };

    let translation = lang
      ? await this.prisma.static_page_translations.findFirst({
          where: { ...baseWhere, lang },
          include: { static_pages: { include: { static_page_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } } } } },
        })
      : null;

    if (!translation) {
      translation = await this.prisma.static_page_translations.findFirst({
        where: baseWhere,
        orderBy: { lang: 'asc' },
        include: { static_pages: { include: { static_page_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } } } } },
      });
    }

    if (!translation || !translation.static_pages) {
      throw new NotFoundException('Static page not found');
    }

    const page = translation.static_pages;
    return {
      message: 'Static page fetched',
      data: { ...page, translation: resolveTranslation(page.static_page_translations, lang) },
    };
  }

  async create(dto: CreateStaticPageDto, actorId: string) {
    const translations = this.normaliseDefaults(dto.translations).map((t) => ({
      ...t,
      body: sanitizeEditorHtml(t.body),
    }));

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.static_pages.create({
        data: {
          display_order: dto.display_order ?? 0,
          is_published: dto.is_published ?? true,
        },
      });
      await tx.static_page_translations.createMany({
        data: translations.map((t) => ({
          page_id: row.id,
          lang: t.lang,
          title: t.title,
          slug: t.slug,
          body: t.body,
          meta_title: t.meta_title ?? null,
          meta_description: t.meta_description ?? null,
          og_image_id: t.og_image_id ?? null,
          is_default: t.is_default ?? false,
        })),
      });
      return row;
    });

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

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    const scalarPatch: Prisma.static_pagesUpdateInput = { updated_at: new Date() };
    if (dto.display_order !== undefined) scalarPatch.display_order = dto.display_order;
    if (dto.is_published !== undefined) scalarPatch.is_published = dto.is_published;
    if (Object.keys(scalarPatch).length > 1) {
      ops.push(this.prisma.static_pages.update({ where: { id }, data: scalarPatch }));
    }

    if (dto.translations && dto.translations.length > 0) {
      // Sanitize bodies and pin a default like create() so PATCHing a
      // translation set never leaves the row with zero defaults.
      const translations = this.normaliseDefaults(dto.translations).map((t) => ({
        ...t,
        body: sanitizeEditorHtml(t.body),
      }));
      for (const t of translations) {
        ops.push(
          this.prisma.static_page_translations.upsert({
            where: { page_id_lang: { page_id: id, lang: t.lang } },
            create: {
              page_id: id,
              lang: t.lang,
              title: t.title,
              slug: t.slug,
              body: t.body,
              meta_title: t.meta_title ?? null,
              meta_description: t.meta_description ?? null,
              og_image_id: t.og_image_id ?? null,
              is_default: t.is_default ?? false,
            },
            update: {
              title: t.title,
              slug: t.slug,
              body: t.body,
              meta_title: t.meta_title ?? null,
              meta_description: t.meta_description ?? null,
              og_image_id: t.og_image_id ?? null,
              is_default: t.is_default ?? false,
            },
          }),
        );
      }
    }

    // Apply scalar patch + every translation upsert atomically so a mid-batch
    // slug conflict can't leave the page half-updated.
    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
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
    const items = rows.map((row) => {
      const static_page_translations = row.static_page_translations.map((t) => ({
        ...t,
        slug: stripSoftDeleteSuffix(t.slug),
      }));
      return {
        ...row,
        static_page_translations,
        translation: resolveTranslation(static_page_translations, null),
      };
    });
    return {
      message: 'Trash fetched',
      data: { items, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted page. Reverses the slug-suffix trick from
   * softDelete; refused with 409 if a live translation has taken any of the
   * original (lang, slug) pairs since the delete — operator must rename one
   * side and retry.
   */
  async restore(id: string, actorId: string) {
    const page = await this.prisma.static_pages.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { static_page_translations: true },
    });
    if (!page) throw new NotFoundException('Deleted static page not found');

    const restoredSlugs = page.static_page_translations.map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const { lang, original } of restoredSlugs) {
          const conflict = await tx.static_page_translations.findFirst({
            where: { lang, slug: original, NOT: { page_id: id } },
          });
          if (conflict) {
            throw new ConflictException(
              `Cannot restore: slug "${original}" (${lang}) is now used by another static page`,
            );
          }
        }

        for (const { lang, original } of restoredSlugs) {
          await tx.static_page_translations.update({
            where: { page_id_lang: { page_id: id, lang } },
            data: { slug: original },
          });
        }

        await tx.static_pages.update({ where: { id }, data: { deleted_at: null, updated_at: new Date() } });
      });
    } catch (err) {
      // The pre-check above narrows the common case, but at READ COMMITTED a
      // concurrent insert can still claim one of the (lang, slug) pairs between
      // the check and the update — the DB unique constraint is the real
      // backstop. Translate that raw P2002 into the same friendly 409.
      rethrowP2002AsConflict(
        err,
        'Cannot restore: one of the original translation slugs was claimed by another static page',
      );
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

    // Free each translation's (lang, slug) unique constraint by suffixing the
    // slug so a new page can claim the slug while this one sits in trash.
    // Restore reverses the suffix.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      const translations = await tx.static_page_translations.findMany({ where: { page_id: id } });
      for (const t of translations) {
        await tx.static_page_translations.update({
          where: { page_id_lang: { page_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await tx.static_pages.update({ where: { id }, data: { deleted_at: deletedAt } });
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
