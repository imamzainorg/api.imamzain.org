import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto, PostQueryDto, TogglePublishDto, UpdatePostDto } from './dto/post.dto';

function resolveTranslation(translations: any[], lang: string | null) {
  if (!translations || translations.length === 0) return null;
  if (lang) {
    const match = translations.find((t) => t.lang === lang);
    if (match) return match;
  }
  return translations.find((t) => t.is_default) ?? translations[0];
}

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PostQueryDto, lang: string | null, isAdmin = false) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (!isAdmin) where.is_published = true;
    if (query.category_id) where.category_id = query.category_id;

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
        orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.posts.count({ where }),
    ]);

    const mapped = items.map((post) => ({
      ...post,
      translation: resolveTranslation(post.post_translations, lang),
    }));

    return {
      message: 'Posts fetched',
      data: { items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string, lang: string | null) {
    const post = await this.prisma.posts.findFirst({
      where: { id, deleted_at: null },
      include: {
        post_translations: true,
        post_categories: { include: { post_category_translations: true } },
        media: true,
        post_attachments: { include: { media: true }, orderBy: { display_order: 'asc' } },
      },
    });

    if (!post) throw new NotFoundException('Post not found');

    return {
      message: 'Post fetched',
      data: { ...post, translation: resolveTranslation(post.post_translations, lang) },
    };
  }

  async findBySlug(slug: string, lang: string | null) {
    const translation = await this.prisma.post_translations.findFirst({
      where: {
        slug,
        posts: { deleted_at: null, is_published: true },
      },
    });

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

    const defaultCount = dto.translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) {
      throw new BadRequestException('Exactly one translation must have is_default: true');
    }

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.posts.create({
        data: {
          category_id: dto.category_id,
          cover_image_id: dto.cover_image_id ?? null,
          is_published: dto.is_published ?? false,
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
          body: t.body,
          slug: t.slug,
          is_default: t.is_default ?? false,
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

    await this.prisma.$transaction(async (tx) => {
      const updateData: any = { updated_at: new Date() };
      if (dto.category_id !== undefined) updateData.category_id = dto.category_id;
      if (dto.cover_image_id !== undefined) updateData.cover_image_id = dto.cover_image_id;
      if (dto.is_published !== undefined) updateData.is_published = dto.is_published;
      if (dto.published_at !== undefined) updateData.published_at = new Date(dto.published_at);

      await tx.posts.update({ where: { id }, data: updateData });

      if (dto.translations) {
        for (const t of dto.translations) {
          await tx.post_translations.upsert({
            where: { post_id_lang: { post_id: id, lang: t.lang } },
            create: { post_id: id, lang: t.lang, title: t.title, summary: t.summary ?? null, body: t.body, slug: t.slug, is_default: t.is_default ?? false },
            update: { title: t.title, summary: t.summary ?? null, body: t.body, slug: t.slug, is_default: t.is_default ?? false },
          });
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

  async trackView(id: string) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null, is_published: true } });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.posts.update({ where: { id }, data: { views: { increment: 1 } } });
    return { message: 'View tracked', data: null };
  }

  async softDelete(id: string, userId: string) {
    const post = await this.prisma.posts.findFirst({ where: { id, deleted_at: null } });
    if (!post) throw new NotFoundException('Post not found');

    await this.prisma.posts.update({ where: { id }, data: { deleted_at: new Date() } });

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
