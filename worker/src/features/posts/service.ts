import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit, auditMany } from '../../lib/audit';
import { currentUser } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { assertExactlyOneDefault, loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { MEDIA_VARIANT_SELECT, OG_IMAGE_SELECT, PUBLIC_MEDIA_SELECT } from '../../lib/media-selects';
import { buildPaginationMeta } from '../../lib/pagination';
import { assertSlugRenameAllowed, resolvePublishedAt } from '../../lib/publish-rules';
import { withinLimit } from '../../lib/rate-limit';
import { readingTimeMinutes } from '../../lib/reading-time';
import { sanitizeEditorHtml } from '../../lib/html-sanitize';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../../lib/soft-delete';
import type { AppEnv } from '../../lib/types';
import type { CreatePostInput, PostQuery, UpdatePostInput } from './schemas';

type Ctx = Context<AppEnv>;

const POST_DETAIL_INCLUDE = {
  post_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
  post_categories: { include: { post_category_translations: true } },
  media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } } } },
  post_attachments: {
    include: { media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } } } } },
    orderBy: { display_order: 'asc' as const },
  },
} satisfies Prisma.postsInclude;

// The public detail is an allow-list: no `created_by` (a staff user id) and embedded media without
// file_size / uploaded_by. Admin reads keep the full rows.
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
    orderBy: { display_order: 'asc' as const },
  },
} satisfies Prisma.postsSelect;

// Lists drop the full `body` (5–50 KB of HTML per translation) and keep one attachment as a thumbnail.
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
      post_category_translations: { select: { category_id: true, lang: true, title: true, slug: true, description: true } },
    },
  },
  media: { select: PUBLIC_MEDIA_SELECT },
  post_attachments: {
    take: 1,
    select: { post_id: true, media_id: true, display_order: true, media: { select: { id: true, url: true, mime_type: true, filename: true } } },
    orderBy: { display_order: 'asc' as const },
  },
} satisfies Prisma.postsSelect;

// A list translation carries no body, so its reading time is unknown and reported as 0.
const withZeroReadingTime = <T extends object>(t: T) => ({ ...t, reading_time_minutes: 0 });
const withReadingTime = <T extends { body?: string | null }>(t: T) => ({ ...t, reading_time_minutes: readingTimeMinutes(t.body ?? null) });

const OG_IMAGE_NOT_FOUND = 'One or more og_image_id values do not match any media record';

// Only the slug index may say "slug already used": the other unique keys a post write can hit are the
// (post, lang) and (post, media) keys of its child tables.
function postConflictMessages(slug: string | null | undefined): { fallback: string; byTarget: Record<string, string> } {
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

export async function findAll(c: Ctx, query: PostQuery, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.postsWhereInput = { deleted_at: null };
  if (!isAdmin) {
    where.is_published = true;
  } else if (query.status && query.status !== 'all') {
    // The status tabs are the CMS's; the public route ignores the filter and only ever lists published posts.
    const now = new Date();
    if (query.status === 'published') {
      where.is_published = true;
    } else if (query.status === 'draft') {
      where.is_published = false;
      where.OR = [{ published_at: null }, { published_at: { lte: now } }];
    } else if (query.status === 'scheduled') {
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
          { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { body: { contains: query.search, mode: 'insensitive' } }] },
          lang ? { OR: [{ lang }, { is_default: true }] } : { is_default: true },
        ],
      },
    };
  }

  const orderBy: Prisma.postsOrderByWithRelationInput[] =
    query.sort === 'views' ? [{ views: 'desc' }, { id: 'asc' }] : [{ published_at: 'desc' }, { created_at: 'desc' }, { id: 'asc' }];

  const [items, total, active] = await Promise.all([
    db.posts.findMany({ where, select: POST_LIST_SELECT, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
    db.posts.count({ where }),
    loadActiveLanguages(db),
  ]);

  const mapped = items.map((post) => {
    const decorated = post.post_translations.map(withZeroReadingTime);
    return { ...post, post_translations: decorated, translation: resolveTranslation(decorated, lang, { active }) };
  });

  return { message: 'Posts fetched', data: { items: mapped, pagination: buildPaginationMeta(query.page, query.limit, total) } };
}

function presentDetail<T extends { post_translations: { body?: string | null; lang?: string; is_default?: boolean }[] }>(
  post: T,
  lang: string | null,
  active: ReadonlySet<string>,
) {
  const decorated = post.post_translations.map(withReadingTime);
  return { message: 'Post fetched', data: { ...post, post_translations: decorated, translation: resolveTranslation(decorated, lang, { active }) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.postsWhereInput = { id, deleted_at: null };
  if (!isAdmin) where.is_published = true;

  // Two literal query shapes: the admin `include` and the public allow-list `select` type differently.
  const [post, active] = await Promise.all([
    isAdmin ? db.posts.findFirst({ where, include: POST_DETAIL_INCLUDE }) : db.posts.findFirst({ where, select: POST_PUBLIC_DETAIL_SELECT }),
    loadActiveLanguages(db),
  ]);
  if (!post) throw notFound('Post not found');
  return presentDetail(post, lang, active);
}

export async function findBySlug(c: Ctx, slug: string, lang: string | null) {
  const db = getDb(c);
  const [post, active] = await Promise.all([
    db.posts.findFirst({ where: { slug, deleted_at: null, is_published: true }, select: POST_PUBLIC_DETAIL_SELECT }),
    loadActiveLanguages(db),
  ]);
  if (!post) throw notFound('Post not found');
  return presentDetail(post, lang, active);
}

async function assertOgImagesExist(c: Ctx, translations: { og_image_id?: string | null }[]) {
  const ids = translations.map((t) => t.og_image_id).filter((v): v is string => typeof v === 'string');
  if (ids.length === 0) return;
  const found = await getDb(c).media.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw notFound(OG_IMAGE_NOT_FOUND);
}

// A trashed post's slug is suffixed, so it can't clash here.
async function assertSlugAvailable(c: Ctx, slug: string, excludePostId: string | null) {
  const clash = await getDb(c).posts.findFirst({ where: { slug, ...(excludePostId ? { NOT: { id: excludePostId } } : {}) }, select: { id: true } });
  if (clash) throw conflict(`Slug "${slug}" is already used by another post`);
}

export async function create(c: Ctx, input: CreatePostInput, lang: string | null) {
  const db = getDb(c);
  const category = await db.post_categories.findFirst({ where: { id: input.category_id, deleted_at: null } });
  if (!category) throw notFound('Category not found');

  if (input.cover_image_id) {
    const media = await db.media.findUnique({ where: { id: input.cover_image_id } });
    if (!media) throw notFound('Cover image not found');
  }

  await assertOgImagesExist(c, input.translations);

  assertExactlyOneDefault(input.translations);
  await assertSlugAvailable(c, input.slug, null);

  // A post created already-published must not carry a future or missing published_at: either pins it to
  // the top of every `published_at DESC` list (public list, homepage, RSS). A draft keeps only a FUTURE
  // date, a schedule; a past one would be picked up by the publish cron within a minute.
  const isPublished = input.is_published ?? false;
  const publishedAt = resolvePublishedAt({
    willBePublished: isPublished,
    wasPublished: false,
    stored: null,
    requested: input.published_at ? new Date(input.published_at) : null,
  });
  const userId = currentUser(c).id;

  let post: { id: string };
  try {
    post = await db.$transaction(async (tx) => {
      const created = await tx.posts.create({
        data: {
          category_id: input.category_id,
          cover_image_id: input.cover_image_id ?? null,
          slug: input.slug,
          is_published: isPublished,
          is_featured: input.is_featured ?? false,
          published_at: publishedAt,
          created_by: userId,
        },
      });

      await tx.post_translations.createMany({
        data: input.translations.map((t) => ({
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

      if (input.attachment_ids && input.attachment_ids.length > 0) {
        await tx.post_attachments.createMany({
          data: input.attachment_ids.map((mediaId, index) => ({ post_id: created.id, media_id: mediaId, display_order: index })),
        });
      }

      return created;
    });
  } catch (err) {
    const { fallback, byTarget } = postConflictMessages(input.slug);
    rethrowP2002AsConflict(err, fallback, byTarget);
  }

  audit(c, { action: AUDIT_ACTIONS.POST_CREATED, resourceType: 'post', resourceId: post.id, changes: { method: 'POST', path: '/api/v1/posts' } });

  const { data } = await findOne(c, post.id, lang, true);
  return { message: 'Post created', data };
}

export async function update(c: Ctx, id: string, input: UpdatePostInput, lang: string | null) {
  const db = getDb(c);
  const post = await db.posts.findFirst({ where: { id, deleted_at: null } });
  if (!post) throw notFound('Post not found');

  if (input.category_id !== undefined && input.category_id !== post.category_id) {
    const category = await db.post_categories.findFirst({ where: { id: input.category_id as string, deleted_at: null } });
    if (!category) throw notFound('Category not found');
  }

  if (input.cover_image_id) {
    const media = await db.media.findUnique({ where: { id: input.cover_image_id } });
    if (!media) throw notFound('Cover image not found');
  }

  if (input.translations) await assertOgImagesExist(c, input.translations);

  assertSlugRenameAllowed({
    resourceLabel: 'post',
    currentSlug: post.slug,
    nextSlug: input.slug,
    isPublished: post.is_published,
    willBePublished: input.is_published ?? post.is_published,
  });
  if (input.slug !== undefined) await assertSlugAvailable(c, input.slug as string, id);

  try {
    await db.$transaction(async (tx) => {
      const data: Prisma.postsUpdateInput = { updated_at: new Date() };
      if (input.category_id !== undefined) data.post_categories = { connect: { id: input.category_id as string } };
      if (input.cover_image_id !== undefined) data.media = input.cover_image_id ? { connect: { id: input.cover_image_id } } : { disconnect: true };
      if (input.slug !== undefined) data.slug = input.slug as string;
      if (input.is_published !== undefined) data.is_published = input.is_published as boolean;
      if (input.is_featured !== undefined) data.is_featured = input.is_featured as boolean;

      // published_at is never copied straight from the request: resolvePublishedAt keeps a live post from
      // being future-dated or undated, and an unpublished one from a past date the publish cron would act
      // on (the CMS form re-sends the stored date verbatim when it unpublishes).
      const nextPublishedAt = resolvePublishedAt({
        willBePublished: input.is_published ?? post.is_published,
        wasPublished: post.is_published,
        stored: post.published_at,
        requested: input.published_at === undefined ? undefined : input.published_at ? new Date(input.published_at) : null,
      });
      if (nextPublishedAt?.getTime() !== post.published_at?.getTime()) data.published_at = nextPublishedAt;

      await tx.posts.update({ where: { id }, data });

      if (input.translations) {
        for (const t of input.translations) {
          const row = {
            title: t.title,
            summary: t.summary ?? null,
            body: sanitizeEditorHtml(t.body),
            is_default: t.is_default ?? false,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
          };
          await tx.post_translations.upsert({
            where: { post_id_lang: { post_id: id, lang: t.lang } },
            create: { post_id: id, lang: t.lang, ...row },
            update: row,
          });
        }

        // A partial update that flips is_default on one row must not leave 0 or 2+ defaults.
        const defaults = await tx.post_translations.count({ where: { post_id: id, is_default: true } });
        if (defaults !== 1) throw badRequest('Exactly one translation must have is_default: true');
      }

      if (input.attachment_ids !== undefined) {
        await tx.post_attachments.deleteMany({ where: { post_id: id } });
        if (input.attachment_ids && input.attachment_ids.length > 0) {
          await tx.post_attachments.createMany({
            data: input.attachment_ids.map((mediaId, index) => ({ post_id: id, media_id: mediaId, display_order: index })),
          });
        }
      }
    });
  } catch (err) {
    const { fallback, byTarget } = postConflictMessages(input.slug);
    rethrowP2002AsConflict(err, fallback, byTarget);
  }

  audit(c, { action: AUDIT_ACTIONS.POST_UPDATED, resourceType: 'post', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/posts/${id}` } });

  const { data } = await findOne(c, id, lang, true);
  return { message: 'Post updated', data };
}

export async function togglePublish(c: Ctx, id: string, isPublished: boolean, lang: string | null) {
  const db = getDb(c);
  const post = await db.posts.findFirst({ where: { id, deleted_at: null }, select: { id: true, is_published: true, published_at: true } });
  if (!post) throw notFound('Post not found');

  // Already in the requested state: no write, no audit row, no updated_at bump. A schedule on an
  // unpublished post is left alone; PATCH { published_at: null } cancels it.
  if (post.is_published === isPublished) {
    const { data } = await findOne(c, id, lang, true);
    return { message: 'Post already in requested state', data };
  }

  const now = new Date();
  const data: Prisma.postsUpdateInput = { is_published: isPublished, updated_at: now };
  if (isPublished) {
    // "Publish now" on a scheduled post must not keep its future date; a past date (a due schedule the
    // cron had not reached yet) is kept.
    if (!post.published_at || post.published_at > now) data.published_at = now;
  } else {
    // A past published_at left on an unpublished post is a due schedule: the cron would re-publish it.
    data.published_at = null;
  }

  await db.posts.update({ where: { id }, data });

  audit(c, {
    action: isPublished ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_UNPUBLISHED,
    resourceType: 'post',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/posts/${id}/publish`, is_published: isPublished },
  });

  const { data: detail } = await findOne(c, id, lang, true);
  return { message: `Post ${isPublished ? 'published' : 'unpublished'}`, data: detail };
}

// One counted view per client IP per post: the RL_VIEW binding keyed on `ip:resource` replaces Nest's
// 30-minute claim (D7), so the window is 60 s. A repeat answers like a counted view but adds nothing.
export async function trackView(c: Ctx, id: string) {
  const db = getDb(c);
  const ip = c.get('ip');
  const first = !ip || (await withinLimit(c.env, 'RL_VIEW', `${ip}:${id}`));

  if (!first) {
    // A repeat must not turn a since-deleted or unpublished post into a 200.
    const live = await db.posts.count({ where: { id, deleted_at: null, is_published: true } });
    if (live === 0) throw notFound('Post not found');
    return { message: 'View tracked', data: null };
  }

  const result = await db.posts.updateMany({ where: { id, deleted_at: null, is_published: true }, data: { views: { increment: 1 } } });
  if (result.count === 0) throw notFound('Post not found');
  return { message: 'View tracked', data: null };
}

export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.postsWhereInput = { deleted_at: { not: null } };
  const [items, total, active] = await Promise.all([
    db.posts.findMany({ where, select: POST_LIST_SELECT, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.posts.count({ where }),
    loadActiveLanguages(db),
  ]);

  // The slug comes back without its `__del_` suffix so the CMS shows the original.
  const mapped = items.map((post) => {
    const post_translations = post.post_translations.map(withZeroReadingTime);
    return {
      ...post,
      slug: post.slug ? stripSoftDeleteSuffix(post.slug) : post.slug,
      post_translations,
      translation: resolveTranslation(post_translations, null, { active }),
    };
  });

  return { message: 'Trash fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const post = await db.posts.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!post) throw notFound('Deleted post not found');

  // The category may have been soft-deleted while the post sat in the trash (a category only blocks on
  // LIVE children), so a live post is never restored under a deleted category.
  const liveCategory = await db.post_categories.findFirst({ where: { id: post.category_id, deleted_at: null }, select: { id: true } });
  if (!liveCategory) throw conflict('Cannot restore: the parent category was deleted — restore the category first');

  const originalSlug = post.slug ? stripSoftDeleteSuffix(post.slug) : null;

  try {
    await db.$transaction(async (tx) => {
      if (originalSlug) {
        const clash = await tx.posts.findFirst({ where: { slug: originalSlug, deleted_at: null, NOT: { id } }, select: { id: true } });
        if (clash) throw conflict(`Cannot restore: slug "${originalSlug}" is now used by another post`);
      }

      await tx.posts.update({
        where: { id },
        data: { deleted_at: null, updated_at: new Date(), ...(originalSlug ? { slug: originalSlug } : {}) },
      });
    });
  } catch (err) {
    // At READ COMMITTED a concurrent insert can claim the slug after the check: the unique index is the backstop.
    rethrowP2002AsConflict(err, 'Cannot restore: the original slug was claimed by another post');
  }

  audit(c, { action: AUDIT_ACTIONS.POST_RESTORED, resourceType: 'post', resourceId: id, changes: { method: 'POST', path: `/api/v1/posts/${id}/restore` } });

  return { message: 'Post restored', data: null };
}

// Posts that are missing, soft-deleted or already in the target state go to `skipped`.
export async function bulkSetPublish(c: Ctx, ids: string[], isPublished: boolean) {
  const db = getDb(c);
  const uniqueIds = Array.from(new Set(ids));
  const existing = await db.posts.findMany({
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
    if (!row || row.is_published === isPublished) {
      skipped.push(id);
      continue;
    }
    // Publishing stamps "now" over a missing OR future date (see togglePublish).
    if (isPublished && (!row.published_at || row.published_at > now)) idsNeedingStamp.push(id);
    else idsAlreadyStamped.push(id);
  }

  const targetCount = idsNeedingStamp.length + idsAlreadyStamped.length;
  if (targetCount === 0) return { message: 'No posts updated', data: { affected: 0, skipped } };

  await db.$transaction(async (tx) => {
    if (idsAlreadyStamped.length > 0) {
      await tx.posts.updateMany({
        where: { id: { in: idsAlreadyStamped } },
        // Unpublishing clears published_at, see togglePublish.
        data: isPublished ? { is_published: true, updated_at: now } : { is_published: false, updated_at: now, published_at: null },
      });
    }
    if (idsNeedingStamp.length > 0) {
      await tx.posts.updateMany({ where: { id: { in: idsNeedingStamp } }, data: { is_published: isPublished, updated_at: now, published_at: now } });
    }
  });

  const action = isPublished ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_UNPUBLISHED;
  auditMany(
    c,
    [...idsAlreadyStamped, ...idsNeedingStamp].map((resourceId) => ({
      action,
      resourceType: 'post',
      resourceId,
      changes: { method: 'POST', path: '/api/v1/posts/bulk/publish', is_published: isPublished, bulk: true },
    })),
  );

  return { message: `${targetCount} post(s) ${isPublished ? 'published' : 'unpublished'}`, data: { affected: targetCount, skipped } };
}

export async function bulkDelete(c: Ctx, ids: string[]) {
  const db = getDb(c);
  const uniqueIds = Array.from(new Set(ids));
  const existing = await db.posts.findMany({ where: { id: { in: uniqueIds }, deleted_at: null }, select: { id: true } });
  const existingIds = new Set(existing.map((p) => p.id));

  const skipped = uniqueIds.filter((id) => !existingIds.has(id));
  const targetIds = uniqueIds.filter((id) => existingIds.has(id));
  if (targetIds.length === 0) return { message: 'No posts deleted', data: { affected: 0, skipped } };

  const deletedAt = new Date();
  const suffix = softDeleteSuffix(deletedAt);

  await db.$transaction(async (tx) => {
    // One raw UPDATE suffixes every slug in the batch instead of N reads and writes.
    await tx.$executeRaw`UPDATE posts SET slug = slug || ${suffix} WHERE id = ANY(${targetIds}::uuid[])`;
    await tx.posts.updateMany({ where: { id: { in: targetIds } }, data: { deleted_at: deletedAt } });
  });

  auditMany(
    c,
    targetIds.map((resourceId) => ({
      action: AUDIT_ACTIONS.POST_DELETED,
      resourceType: 'post',
      resourceId,
      changes: { method: 'POST', path: '/api/v1/posts/bulk/delete', bulk: true },
    })),
  );

  return { message: `${targetIds.length} post(s) deleted`, data: { affected: targetIds.length, skipped } };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const post = await db.posts.findFirst({ where: { id, deleted_at: null } });
  if (!post) throw notFound('Post not found');

  // Suffixing frees the slug's unique index while the post sits in the trash; restore strips it back off.
  const deletedAt = new Date();
  await db.posts.update({ where: { id }, data: { deleted_at: deletedAt, ...(post.slug ? { slug: `${post.slug}${softDeleteSuffix(deletedAt)}` } : {}) } });

  audit(c, { action: AUDIT_ACTIONS.POST_DELETED, resourceType: 'post', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/posts/${id}` } });

  return { message: 'Post deleted', data: null };
}
