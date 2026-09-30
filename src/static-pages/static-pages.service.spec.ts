import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaticPagesService } from './static-pages.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { OG_IMAGE_SELECT } from '../common/crud/media-selects';

const listRow = (id: string, translations: any[]) => ({
  id,
  display_order: 0,
  is_published: true,
  slug: `page-${id}`,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
  deleted_at: null,
  static_page_translations: translations,
});

const slimTranslation = (lang: string, isDefault: boolean) => ({
  page_id: 'p1',
  lang,
  title: `title-${lang}`,
  is_default: isDefault,
  meta_title: null,
  meta_description: null,
  og_image_id: null,
});

const fullPage = {
  id: 'p1',
  slug: 'page-p1',
  display_order: 0,
  is_published: true,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  static_page_translations: [
    { page_id: 'p1', lang: 'ar', title: 'ar', body: '<p>ar</p>', is_default: true, og_image: null },
    { page_id: 'p1', lang: 'en', title: 'en', body: '<p>en</p>', is_default: false, og_image: null },
  ],
};

describe('StaticPagesService', () => {
  let service: StaticPagesService;
  let prisma: any;
  let audit: any;

  const mockTx = {
    static_pages: { create: jest.fn(), update: jest.fn() },
    static_page_translations: {
      createMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  beforeEach(async () => {
    audit = { write: jest.fn().mockResolvedValue(true), writeMany: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaticPagesService,
        {
          provide: PrismaService,
          useValue: {
            static_pages: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              update: jest.fn().mockResolvedValue({}),
            },
            media: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn((cb: any) => cb(mockTx)),
          },
        },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(StaticPagesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAllPublic (Q15: body-less list)', () => {
    it('selects slim translation columns — no body — and never `include`s the full rows', async () => {
      await service.findAllPublic(null, 1, 20);

      const args = prisma.static_pages.findMany.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select.static_page_translations.select).toBeDefined();
      expect(args.select.static_page_translations.select).not.toHaveProperty('body');
      expect(args.where).toEqual({ deleted_at: null, is_published: true });
    });

    it('returns only the requested translation, without a body and without the translations array', async () => {
      prisma.static_pages.findMany.mockResolvedValue([
        listRow('p1', [slimTranslation('ar', true), slimTranslation('en', false)]),
      ]);
      prisma.static_pages.count.mockResolvedValue(1);

      const { data } = await service.findAllPublic('en', 1, 20);

      const item: any = data.items[0];
      expect(item.translation).toMatchObject({ lang: 'en', title: 'title-en' });
      expect(item.translation).not.toHaveProperty('body');
      expect(item).not.toHaveProperty('static_page_translations');
      expect(item).toMatchObject({ id: 'p1', slug: 'page-p1', display_order: 0, is_published: true });
    });

    it('falls back to the default translation when the requested language has no row', async () => {
      prisma.static_pages.findMany.mockResolvedValue([
        listRow('p1', [slimTranslation('en', false), slimTranslation('ar', true)]),
      ]);

      const { data } = await service.findAllPublic('fr', 1, 20);

      expect((data.items[0] as any).translation.lang).toBe('ar');
    });

    it('reports translation: null for a page that has no translations at all', async () => {
      prisma.static_pages.findMany.mockResolvedValue([listRow('p1', [])]);

      const { data } = await service.findAllPublic(null, 1, 20);

      expect((data.items[0] as any).translation).toBeNull();
    });

    it('keeps the pagination envelope', async () => {
      prisma.static_pages.count.mockResolvedValue(45);

      const { data } = await service.findAllPublic(null, 2, 20);

      expect(data.pagination).toEqual({ page: 2, limit: 20, total: 45, pages: 3 });
    });
  });

  describe('findAllAdmin', () => {
    it('is unchanged: every translation with its body', async () => {
      await service.findAllAdmin(null, {} as any);

      const args = prisma.static_pages.findMany.mock.calls[0][0];
      expect(args.include).toEqual({ static_page_translations: true });
      expect(args.select).toBeUndefined();
    });
  });

  describe('public detail shape (S23)', () => {
    it('embeds the OG image with the slim OG select only — no file_size / uploaded_by', async () => {
      prisma.static_pages.findFirst.mockResolvedValue(fullPage);

      await service.findOne('p1', null);

      const args = prisma.static_pages.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'p1', deleted_at: null, is_published: true });
      expect(args.include.static_page_translations.include.og_image.select).toBe(OG_IMAGE_SELECT);
      expect(OG_IMAGE_SELECT).not.toHaveProperty('file_size');
      expect(OG_IMAGE_SELECT).not.toHaveProperty('uploaded_by');
    });

    it('findBySlug uses the same slim OG select and only ever finds published pages', async () => {
      prisma.static_pages.findFirst.mockResolvedValue(fullPage);

      const result = await service.findBySlug('page-p1', 'ar');

      const args = prisma.static_pages.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({ slug: 'page-p1', deleted_at: null, is_published: true });
      expect(args.include.static_page_translations.include.og_image.select).toBe(OG_IMAGE_SELECT);
      expect((result.data as any).translation.body).toBe('<p>ar</p>');
      // static_pages has no staff-UUID columns, so the row carries none.
      expect(Object.keys(result.data)).not.toEqual(expect.arrayContaining(['created_by', 'updated_by']));
    });

    it('the detail keeps the body of every translation', async () => {
      prisma.static_pages.findFirst.mockResolvedValue(fullPage);

      const { data } = await service.findOne('p1', 'en');

      expect(data.static_page_translations.map((t: any) => t.body)).toEqual(['<p>ar</p>', '<p>en</p>']);
    });

    it('answers 404 for an unpublished or unknown page', async () => {
      prisma.static_pages.findFirst.mockResolvedValue(null);
      await expect(service.findOne('ghost', null)).rejects.toThrow(NotFoundException);
      await expect(service.findBySlug('ghost', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('og_image_id pre-check (Q13)', () => {
    const ogTranslation = { lang: 'ar', title: 't', body: '<p>b</p>', is_default: true, og_image_id: 'og-1' };
    const missing = new NotFoundException('One or more og_image_id values do not match any media record');

    it('create answers 404 — like posts — when an og_image_id matches no media row, before touching the slug or the DB', async () => {
      prisma.media.findMany.mockResolvedValue([]);

      await expect(
        service.create({ slug: 'new-page', translations: [ogTranslation] } as any, 'user-1'),
      ).rejects.toThrow(missing);

      expect(prisma.static_pages.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update answers 404 when an og_image_id matches no media row, before any write', async () => {
      prisma.static_pages.findFirst.mockResolvedValue({ id: 'p1', slug: 'page-p1', is_published: false });
      prisma.media.findMany.mockResolvedValue([]);

      await expect(
        service.update('p1', { translations: [ogTranslation] } as any, 'user-1'),
      ).rejects.toThrow(missing);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts translations whose og_image_id exists, and counts a repeated id once', async () => {
      prisma.media.findMany.mockResolvedValue([{ id: 'og-1' }]);
      prisma.static_pages.findFirst.mockResolvedValueOnce(null); // slug free
      mockTx.static_pages.create.mockResolvedValue({ id: 'p-new' });
      prisma.static_pages.findFirst.mockResolvedValue({ ...fullPage, id: 'p-new' });

      await service.create(
        {
          slug: 'new-page',
          translations: [ogTranslation, { ...ogTranslation, lang: 'en', is_default: false }],
        } as any,
        'user-1',
      );

      expect(prisma.media.findMany).toHaveBeenCalledWith({ where: { id: { in: ['og-1', 'og-1'] } }, select: { id: true } });
      expect(mockTx.static_pages.create).toHaveBeenCalled();
    });

    it('does not query media at all when no translation carries an og_image_id', async () => {
      prisma.static_pages.findFirst.mockResolvedValueOnce(null);
      mockTx.static_pages.create.mockResolvedValue({ id: 'p-new' });
      prisma.static_pages.findFirst.mockResolvedValue({ ...fullPage, id: 'p-new' });

      await service.create(
        { slug: 'new-page', translations: [{ lang: 'ar', title: 't', body: '<p>b</p>', is_default: true }] } as any,
        'user-1',
      );

      expect(prisma.media.findMany).not.toHaveBeenCalled();
    });
  });

  describe('unique violations (P2002) name the right collision (Q12)', () => {
    const p2002 = (target: unknown) =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target },
      });

    const createWith = (err: unknown) => {
      prisma.static_pages.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(err);
      return service
        .create(
          { slug: 'my-slug', translations: [{ lang: 'ar', title: 't', body: '<p>b</p>', is_default: true }] } as any,
          'user-1',
        )
        .catch((e) => e);
    };

    it.each([['index name', 'uq_static_pages_slug'], ['column list', ['slug']]])(
      'reports a slug collision with the slug message (%s)',
      async (_label, target) => {
        const e = await createWith(p2002(target));
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.message).toBe('Slug "my-slug" is already used by another static page');
      },
    );

    it('does not blame the slug for a duplicated translation language', async () => {
      const e = await createWith(p2002(['page_id', 'lang']));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).not.toMatch(/slug/i);
      expect(e.message).toMatch(/language/);
    });

    it('gives an unknown unique violation a generic conflict message', async () => {
      const e = await createWith(p2002(['something_else']));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).not.toMatch(/slug/i);
    });

    it('lets a non-P2002 error through untouched', async () => {
      const boom = new Error('connection lost');
      expect(await createWith(boom)).toBe(boom);
    });

    it('update without a slug never says Slug "undefined"', async () => {
      prisma.static_pages.findFirst.mockResolvedValue({ id: 'p1', slug: 'page-p1', is_published: false });
      prisma.$transaction.mockRejectedValue(p2002(['page_id', 'lang']));

      const e: any = await service
        .update('p1', { translations: [{ lang: 'ar', title: 't', body: '<p>b</p>' }] } as any, 'user-1')
        .catch((err) => err);

      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).not.toContain('undefined');
      expect(e.message).not.toMatch(/slug/i);
    });
  });

  describe('togglePublish', () => {
    it('is idempotent: already in the requested state writes nothing and audits nothing', async () => {
      prisma.static_pages.findFirst.mockResolvedValue({ ...fullPage, is_published: true });

      const result = await service.togglePublish('p1', { is_published: true }, 'user-1');

      expect(prisma.static_pages.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
      expect(result.message).toBe('Static page already in requested state');
    });

    it('writes and audits once on a real transition', async () => {
      prisma.static_pages.findFirst.mockResolvedValue({ ...fullPage, is_published: false });

      const result = await service.togglePublish('p1', { is_published: true }, 'user-1');

      expect(prisma.static_pages.update).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledTimes(1);
      expect(result.message).toBe('Static page published');
    });
  });
});
