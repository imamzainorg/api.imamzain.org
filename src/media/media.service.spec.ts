import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MediaService } from './media.service';
import { PrismaService } from '../prisma/prisma.service';
import { PENDING_UPLOAD_TTL_SECONDS, R2Service } from '../storage/r2.service';
import { ImageVariantService } from './image-variant.service';
import { AuditService } from '../common/audit/audit.service';
import { VARIANT_PROCESSING_WINDOW_MS } from './media-variants.util';

const OLD = new Date(Date.now() - VARIANT_PROCESSING_WINDOW_MS - 60_000);

const baseMedia = {
  id: 'media-1',
  filename: 'photo.jpg',
  url: 'https://cdn.imamzain.org/media/photo.jpg',
  mime_type: 'image/jpeg',
  file_size: 10240,
  width: 800,
  height: 600,
  alt_text: null,
  created_at: new Date(),
};

const variantRow = (width: number) => ({
  id: `v${width}`,
  width,
  url: `https://cdn.imamzain.org/media/variants/media-1/w${width}.webp`,
  file_size: BigInt(1000),
  format: 'webp',
});

const noPass = { outcome: 'ok', variants: [], mediaPatch: {}, sanitized: false };

/** Lets every already-resolved promise and pending setImmediate run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const REFERENCE_TABLES = [
  'posts',
  'books',
  'gallery_images',
  'post_attachments',
  'post_translations',
  'book_translations',
  'static_page_translations',
  'gallery_image_translations',
] as const;

describe('MediaService', () => {
  let service: MediaService;
  let prisma: any;
  let r2: any;
  let variants: any;
  let audit: any;
  let prismaMediaCreate: jest.Mock;

  beforeEach(async () => {
    prismaMediaCreate = jest.fn();
    const refTable = () => ({ count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: PrismaService,
          useValue: {
            media: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            posts: refTable(),
            books: refTable(),
            gallery_images: refTable(),
            post_attachments: refTable(),
            post_translations: refTable(),
            book_translations: refTable(),
            static_page_translations: refTable(),
            gallery_image_translations: refTable(),
            pending_media_uploads: {
              create: jest.fn().mockResolvedValue({}),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              delete: jest.fn().mockResolvedValue({}),
              deleteMany: jest.fn().mockResolvedValue({}),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            // The tx object mirrors the top-level mocks below (same jest.fn
            // references) so a test's `prisma.posts.count.mockResolvedValue(...)`
            // / `expect(prisma.media.delete)...` still work whether the real
            // code calls `this.prisma.X` directly or `tx.X` inside a
            // `$transaction(async (tx) => ...)` callback (confirmUpload uses
            // its own `create`, since that one isn't asserted against the
            // top-level mock — see prismaMediaCreate).
            $transaction: jest.fn().mockImplementation(async (cb: any) =>
              cb({
                media: { create: prismaMediaCreate, delete: prisma.media.delete },
                pending_media_uploads: { deleteMany: jest.fn().mockResolvedValue({}) },
                posts: { count: prisma.posts.count },
                books: { count: prisma.books.count },
                gallery_images: { count: prisma.gallery_images.count },
                post_attachments: { count: prisma.post_attachments.count },
                post_translations: { count: prisma.post_translations.count },
                book_translations: { count: prisma.book_translations.count },
                static_page_translations: { count: prisma.static_page_translations.count },
                gallery_image_translations: { count: prisma.gallery_image_translations.count },
              }),
            ),
          },
        },
        {
          provide: R2Service,
          useValue: {
            generateUploadUrl: jest.fn(),
            publicUrlForKey: jest.fn().mockImplementation((key: string) => `https://cdn.imamzain.org/${key}`),
            objectExists: jest.fn().mockResolvedValue(true),
            headObject: jest.fn().mockResolvedValue({
              contentType: 'image/jpeg',
              contentLength: 10240,
            }),
            isManagedKey: jest.fn().mockReturnValue(true),
            keyFromPublicUrl: jest.fn().mockImplementation((u: string) =>
              u.replace('https://cdn.imamzain.org/', ''),
            ),
            deleteObject: jest.fn().mockResolvedValue(undefined),
            maxBytesFor: jest.fn().mockReturnValue(25 * 1024 * 1024),
            mediaIdFromKey: jest.fn().mockReturnValue(null),
            isAllowedImageMime: jest.fn((mime: string | undefined) =>
              ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime ?? ''),
            ),
            // First bytes of a JPEG by default — the happy path sniffs clean.
            getObjectPrefix: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])),
          },
        },
        {
          provide: ImageVariantService,
          useValue: {
            processMedia: jest.fn().mockResolvedValue(noPass),
            probeDimensions: jest.fn().mockResolvedValue(null),
            findForMedia: jest.fn().mockResolvedValue([]),
            findForMediaIds: jest.fn().mockResolvedValue(new Map()),
            deleteR2Variants: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
    prisma = module.get(PrismaService);
    r2 = module.get(R2Service);
    variants = module.get(ImageVariantService);
    audit = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('requestUploadUrl', () => {
    it('delegates to r2Service and returns result', async () => {
      r2.generateUploadUrl.mockResolvedValue({
        uploadUrl: 'https://r2.example.com/signed',
        key: 'media/abc-photo.jpg',
        publicUrl: 'https://cdn.imamzain.org/media/abc-photo.jpg',
      });

      const result = await service.requestUploadUrl(
        { filename: 'photo.jpg', mime_type: 'image/jpeg' },
        'user-1',
      );

      expect(r2.generateUploadUrl).toHaveBeenCalledWith('photo.jpg', 'image/jpeg');
      expect(result.data.uploadUrl).toContain('r2.example.com');
    });

    it('gives the pending row exactly the lifetime the presigned URL is capped to (S18)', async () => {
      r2.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://r2.example.com/signed', key: 'media/originals/a/photo.jpg' });
      const before = Date.now();

      await service.requestUploadUrl({ filename: 'photo.jpg', mime_type: 'image/jpeg' }, 'user-1');

      const { data } = prisma.pending_media_uploads.create.mock.calls[0][0];
      expect(data.key).toBe('media/originals/a/photo.jpg');
      expect(data.requested_by).toBe('user-1');
      const lifetimeMs = data.expires_at.getTime() - before;
      expect(lifetimeMs).toBeGreaterThanOrEqual(PENDING_UPLOAD_TTL_SECONDS * 1000);
      expect(lifetimeMs).toBeLessThan(PENDING_UPLOAD_TTL_SECONDS * 1000 + 5_000);
    });
  });

  describe('confirmUpload', () => {
    const confirmDto = {
      key: 'media/photo.jpg',
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      file_size: 10240,
    };

    beforeEach(() => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/photo.jpg',
        requested_by: 'user-1',
      });
    });

    it('creates a media record bound to the user that requested the upload', async () => {
      prismaMediaCreate.mockResolvedValue(baseMedia);

      const result = await service.confirmUpload(confirmDto, 'user-1');

      expect(prismaMediaCreate).toHaveBeenCalled();
      expect(result.message).toBe('Media created');
      expect(result.data.id).toBe('media-1');
    });

    it('rejects when no pending upload matches the key', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue(null);

      await expect(service.confirmUpload(confirmDto, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when the pending upload was issued to a different user', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/photo.jpg',
        requested_by: 'someone-else',
      });

      await expect(service.confirmUpload(confirmDto, 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects with 410 when the pending upload has expired', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/photo.jpg',
        requested_by: 'user-1',
        expires_at: new Date(Date.now() - 60_000),
      });

      await expect(service.confirmUpload(confirmDto, 'user-1')).rejects.toThrow(GoneException);
    });

    it('rejects oversized files with 413, deletes the R2 object and keeps the pending row until it expires', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/originals/abc/big.jpg',
        requested_by: 'user-1',
      });
      // Simulate a 50 MB file (over the 25 MB cap)
      r2.headObject.mockResolvedValueOnce({
        contentType: 'image/jpeg',
        contentLength: 50 * 1024 * 1024,
      });

      await expect(
        service.confirmUpload(
          {
            key: 'media/originals/abc/big.jpg',
            filename: 'big.jpg',
            mime_type: 'image/jpeg',
            file_size: 50 * 1024 * 1024,
          },
          'user-1',
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(r2.deleteObject).toHaveBeenCalledWith('media/originals/abc/big.jpg');
      // The presigned URL still works for the rest of its lifetime: a re-PUT after this point
      // must stay tracked so the hourly sweep deletes it too.
      expect(prisma.pending_media_uploads.deleteMany).not.toHaveBeenCalled();
      expect(prismaMediaCreate).not.toHaveBeenCalled();
    });

    it('still rejects with 413 when the R2 delete itself fails — the row survives for the sweep to retry', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/originals/abc/big.jpg',
        requested_by: 'user-1',
      });
      r2.headObject.mockResolvedValueOnce({ contentType: 'image/jpeg', contentLength: 50 * 1024 * 1024 });
      r2.deleteObject.mockRejectedValueOnce(new Error('R2 unavailable'));

      await expect(
        service.confirmUpload(
          { key: 'media/originals/abc/big.jpg', filename: 'big.jpg', mime_type: 'image/jpeg', file_size: 1 },
          'user-1',
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(prisma.pending_media_uploads.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects an object whose stored Content-Type is not an allowed image type and purges it', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/originals/abc/evil.jpg',
        requested_by: 'user-1',
        expires_at: new Date(Date.now() + 60_000),
      });
      // The presigned PUT was for image/jpeg, but the object was stored as HTML.
      r2.headObject.mockResolvedValueOnce({ contentType: 'text/html', contentLength: 512 });

      await expect(
        service.confirmUpload(
          { key: 'media/originals/abc/evil.jpg', filename: 'evil.jpg', mime_type: 'image/jpeg', file_size: 512 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(r2.deleteObject).toHaveBeenCalledWith('media/originals/abc/evil.jpg');
      expect(prisma.pending_media_uploads.deleteMany).not.toHaveBeenCalled();
      expect(r2.getObjectPrefix).not.toHaveBeenCalled();
      expect(prismaMediaCreate).not.toHaveBeenCalled();
    });

    it('rejects bytes that are not a real image even when the Content-Type says image/png', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/originals/abc/fake.png',
        requested_by: 'user-1',
        expires_at: new Date(Date.now() + 60_000),
      });
      r2.headObject.mockResolvedValueOnce({ contentType: 'image/png', contentLength: 512 });
      r2.getObjectPrefix.mockResolvedValueOnce(Buffer.from('<svg onload="alert(1)">'));

      await expect(
        service.confirmUpload(
          { key: 'media/originals/abc/fake.png', filename: 'fake.png', mime_type: 'image/png', file_size: 512 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      // One ranged read serves both the magic-number sniff and the header probe.
      expect(r2.getObjectPrefix).toHaveBeenCalledWith('media/originals/abc/fake.png', 128 * 1024);
      expect(r2.deleteObject).toHaveBeenCalledWith('media/originals/abc/fake.png');
      expect(variants.probeDimensions).not.toHaveBeenCalled();
      expect(prismaMediaCreate).not.toHaveBeenCalled();
    });

    it('persists the stored (allowed) Content-Type as mime_type once the bytes sniff clean', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/originals/abc/photo.jpg',
        requested_by: 'user-1',
        expires_at: new Date(Date.now() + 60_000),
      });
      r2.headObject.mockResolvedValueOnce({ contentType: 'image/jpeg', contentLength: 2048 });
      prismaMediaCreate.mockResolvedValue(baseMedia);

      await service.confirmUpload(
        { key: 'media/originals/abc/photo.jpg', filename: 'photo.jpg', mime_type: 'image/png', file_size: 1 },
        'user-1',
      );

      expect(prismaMediaCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mime_type: 'image/jpeg', file_size: 2048 }) }),
      );
    });

    it('pins the new media row id to the uuid baked into a new-format key', async () => {
      const plannedId = '9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f';
      r2.mediaIdFromKey.mockReturnValueOnce(plannedId);
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: `media/originals/${plannedId}/photo.jpg`,
        requested_by: 'user-1',
      });
      prismaMediaCreate.mockResolvedValue({ ...baseMedia, id: plannedId });

      await service.confirmUpload({ ...confirmDto, key: `media/originals/${plannedId}/photo.jpg` }, 'user-1');

      expect(prismaMediaCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ id: plannedId }) }),
      );
    });

    describe('true dimensions (B-Med4)', () => {
      it('stores the size read from the file, not the size the client declared', async () => {
        variants.probeDimensions.mockResolvedValue({ width: 300, height: 600 });
        prismaMediaCreate.mockResolvedValue({ ...baseMedia, width: 300, height: 600 });

        await service.confirmUpload({ ...confirmDto, width: 600, height: 300 }, 'user-1');

        expect(prismaMediaCreate).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ width: 300, height: 600 }) }),
        );
      });

      it('falls back to the declared size when the header cannot be probed (the background pass corrects it)', async () => {
        variants.probeDimensions.mockResolvedValue(null);
        prismaMediaCreate.mockResolvedValue(baseMedia);

        await service.confirmUpload({ ...confirmDto, width: 640, height: 480 }, 'user-1');

        expect(prismaMediaCreate).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ width: 640, height: 480 }) }),
        );
      });

      it('stores null dimensions when neither the file nor the client supplied any', async () => {
        prismaMediaCreate.mockResolvedValue(baseMedia);

        await service.confirmUpload(confirmDto, 'user-1');

        expect(prismaMediaCreate).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ width: null, height: null }) }),
        );
      });
    });

    describe('variant contract (B-Med1)', () => {
      it('answers with the widths to expect and "processing" — never a promise of exactly four', async () => {
        prismaMediaCreate.mockResolvedValue({ ...baseMedia, width: 1200, created_at: new Date() });

        const { data } = await service.confirmUpload(confirmDto, 'user-1');

        expect(data.variants).toEqual([]);
        expect(data.planned_widths).toEqual([320, 768]);
        expect(data.variants_status).toBe('processing');
        expect(data.variants_status_reason).toBeUndefined();
      });

      it('says TOO_SMALL straight away for an original that cannot have variants', async () => {
        prismaMediaCreate.mockResolvedValue({ ...baseMedia, width: 200, created_at: new Date() });

        const { data } = await service.confirmUpload(confirmDto, 'user-1');

        expect(data.planned_widths).toEqual([]);
        expect(data.variants_status).toBe('unavailable');
        expect(data.variants_status_reason).toBe('TOO_SMALL');
      });

      it('starts the background pass through the shared gate with the created row and the key', async () => {
        prismaMediaCreate.mockResolvedValue(baseMedia);

        await service.confirmUpload(confirmDto, 'user-1');
        await flush();

        expect(variants.processMedia).toHaveBeenCalledWith(baseMedia, 'media/photo.jpg');
      });

      it('does not fail the confirm when the background pass blows up', async () => {
        prismaMediaCreate.mockResolvedValue(baseMedia);
        variants.processMedia.mockRejectedValue(new Error('sharp exploded'));

        await expect(service.confirmUpload(confirmDto, 'user-1')).resolves.toMatchObject({ message: 'Media created' });
        await flush();
      });
    });
  });

  describe('regenerateVariants', () => {
    const passWith = (over: Record<string, unknown>) => ({ ...noPass, ...over });

    it('throws NotFoundException when the media does not exist', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.regenerateVariants('ghost', 'user-1')).rejects.toThrow(NotFoundException);
      expect(variants.processMedia).not.toHaveBeenCalled();
    });

    it('reports ready with the rows now in the database, and records the run', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 1200, created_at: OLD });
      variants.processMedia.mockResolvedValue(passWith({ variants: [variantRow(320), variantRow(768)] }));
      variants.findForMedia.mockResolvedValue([variantRow(320), variantRow(768)]);

      const { data } = await service.regenerateVariants('media-1', 'user-1');

      expect(variants.processMedia).toHaveBeenCalledWith(expect.objectContaining({ id: 'media-1' }), 'media/photo.jpg');
      expect(data.variants).toHaveLength(2);
      expect(data.planned_widths).toEqual([320, 768]);
      expect(data.variants_status).toBe('ready');
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          resourceId: 'media-1',
          changes: expect.objectContaining({ variants_generated: 2, variants_status: 'ready' }),
        }),
      );
    });

    it('returns the corrected dimensions and size the pass persisted, not the stale row', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 1500, height: 400, created_at: OLD });
      variants.processMedia.mockResolvedValue(passWith({ mediaPatch: { width: 400, height: 1500, file_size: BigInt(777) }, sanitized: true }));
      variants.findForMedia.mockResolvedValue([variantRow(320)]);

      const { data } = await service.regenerateVariants('media-1', 'user-1');

      expect(data.width).toBe(400);
      expect(data.height).toBe(1500);
      expect(data.file_size).toBe(BigInt(777));
      // Planned from the REAL width: 320 only, so one variant is a complete set.
      expect(data.planned_widths).toEqual([320]);
      expect(data.variants_status).toBe('ready');
    });

    it('answers 200 with unavailable / ORIGINAL_MISSING when the original is not in storage (B-Med3)', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 1200, created_at: OLD });
      variants.processMedia.mockResolvedValue(passWith({ outcome: 'original_missing' }));

      const { message, data } = await service.regenerateVariants('media-1', 'user-1');

      expect(message).toBe('Variants regenerated');
      expect(data.variants).toEqual([]);
      expect(data.variants_status).toBe('unavailable');
      expect(data.variants_status_reason).toBe('ORIGINAL_MISSING');
    });

    it('answers unavailable / TOO_SMALL for an image under the smallest width (B-Med3)', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 250, created_at: OLD });

      const { data } = await service.regenerateVariants('media-1', 'user-1');

      expect(data.variants_status).toBe('unavailable');
      expect(data.variants_status_reason).toBe('TOO_SMALL');
      expect(data.planned_widths).toEqual([]);
    });

    it('answers not_applicable / ANIMATED for an animated GIF (B-Med7)', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, mime_type: 'image/gif', width: 800, created_at: OLD });
      variants.processMedia.mockResolvedValue(passWith({ outcome: 'animated' }));

      const { data } = await service.regenerateVariants('media-1', 'user-1');

      expect(data.variants_status).toBe('not_applicable');
      expect(data.variants_status_reason).toBe('ANIMATED');
      expect(data.planned_widths).toEqual([]);
    });

    it('reports partial (not processing) when the pass ran but some variants failed', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 1200, created_at: new Date() });
      variants.processMedia.mockResolvedValue(passWith({ variants: [variantRow(320)] }));
      variants.findForMedia.mockResolvedValue([variantRow(320)]);

      const { data } = await service.regenerateVariants('media-1', 'user-1');

      expect(data.variants_status).toBe('partial');
      expect(data.variants_status_reason).toBe('GENERATION_INCOMPLETE');
    });

    it('goes through the same concurrency gate as confirm: at most two passes at once (B-Med6)', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, created_at: OLD });
      const release: Array<() => void> = [];
      variants.processMedia.mockImplementation(() => new Promise((resolve) => release.push(() => resolve(noPass))));

      const calls = [1, 2, 3].map(() => service.regenerateVariants('media-1', 'user-1'));
      await flush();
      expect(variants.processMedia).toHaveBeenCalledTimes(2);

      release[0]();
      await flush();
      expect(variants.processMedia).toHaveBeenCalledTimes(3);

      release[1]();
      release[2]();
      await Promise.all(calls);
    });
  });

  describe('findAll', () => {
    it('returns paginated media', async () => {
      prisma.media.findMany.mockResolvedValue([baseMedia]);
      prisma.media.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });
    });

    it('gives every item its own variants plus planned_widths and variants_status', async () => {
      const ready = { ...baseMedia, id: 'ready', width: 1200, created_at: OLD };
      const small = { ...baseMedia, id: 'small', width: 200, created_at: OLD };
      const stuck = { ...baseMedia, id: 'stuck', width: 1200, created_at: OLD };
      prisma.media.findMany.mockResolvedValue([ready, small, stuck]);
      prisma.media.count.mockResolvedValue(3);
      variants.findForMediaIds.mockResolvedValue(
        new Map([
          ['ready', [variantRow(320), variantRow(768)]],
          ['stuck', [variantRow(320)]],
        ]),
      );

      const { data } = await service.findAll({ page: 1, limit: 10 });
      const byId = Object.fromEntries(data.items.map((i: any) => [i.id, i]));

      expect(byId.ready.variants_status).toBe('ready');
      expect(byId.ready.planned_widths).toEqual([320, 768]);
      expect(byId.small.variants_status).toBe('unavailable');
      expect(byId.small.variants_status_reason).toBe('TOO_SMALL');
      expect(byId.stuck.variants_status).toBe('partial');
      expect(byId.stuck.variants).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns media when found', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);

      const result = await service.findOne('media-1');

      expect(result.data.id).toBe('media-1');
    });

    it('keeps the variants array as is and adds the derived contract fields', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 1200, created_at: OLD });
      variants.findForMedia.mockResolvedValue([variantRow(320), variantRow(768)]);

      const { data } = await service.findOne('media-1');

      expect(data.variants).toEqual([variantRow(320), variantRow(768)]);
      expect(data.planned_widths).toEqual([320, 768]);
      expect(data.variants_status).toBe('ready');
    });

    it('a fresh upload with no variants yet is "processing"', async () => {
      prisma.media.findUnique.mockResolvedValue({ ...baseMedia, width: 1200, created_at: new Date() });

      expect((await service.findOne('media-1')).data.variants_status).toBe('processing');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('malformed ids (Q14)', () => {
    // The controller no longer runs ParseUUIDPipe, so a non-UUID reaches the service.
    // Prisma answers it with P2023, which AllExceptionsFilter turns into 400
    // INVALID_IDENTIFIER — provided the service lets it through untouched and has done
    // no work (storage, sharp) before that first lookup.
    const p2023 = () =>
      new Prisma.PrismaClientKnownRequestError('Inconsistent column data: Error creating UUID', {
        code: 'P2023',
        clientVersion: 'test',
      });

    it.each([
      ['findOne', (s: MediaService) => s.findOne('not-a-uuid')],
      ['findReferences', (s: MediaService) => s.findReferences('not-a-uuid')],
      ['update', (s: MediaService) => s.update('not-a-uuid', { alt_text: 'x' }, 'user-1')],
      ['regenerateVariants', (s: MediaService) => s.regenerateVariants('not-a-uuid', 'user-1')],
      ['delete', (s: MediaService) => s.delete('not-a-uuid', 'user-1')],
    ])('%s surfaces the P2023 unchanged and touches nothing else', async (_name, call) => {
      const error = p2023();
      prisma.media.findUnique.mockRejectedValue(error);

      await expect(call(service)).rejects.toBe(error);

      expect(prisma.media.findUnique).toHaveBeenCalledTimes(1);
      expect(variants.processMedia).not.toHaveBeenCalled();
      expect(variants.findForMedia).not.toHaveBeenCalled();
      expect(variants.deleteR2Variants).not.toHaveBeenCalled();
      expect(r2.deleteObject).not.toHaveBeenCalled();
      expect(prisma.media.delete).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates alt_text and returns updated media', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);
      prisma.media.update.mockResolvedValue({ ...baseMedia, alt_text: 'A photo' });

      const result = await service.update('media-1', { alt_text: 'A photo' }, 'user-1');

      expect(result.data.alt_text).toBe('A photo');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', {}, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);
      prisma.media.delete.mockResolvedValue({});
    });

    const conflictBody = async (): Promise<any> => {
      try {
        await service.delete('media-1', 'user-1');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        return (err as ConflictException).getResponse();
      }
      throw new Error('expected a ConflictException');
    };

    it('deletes the row first — inside the transactional recheck — and the stored files only afterwards', async () => {
      const result = await service.delete('media-1', 'user-1');

      expect(prisma.media.delete).toHaveBeenCalledWith({ where: { id: 'media-1' } });
      expect(variants.deleteR2Variants).toHaveBeenCalledWith('media-1');
      expect(r2.deleteObject).toHaveBeenCalledWith('media/photo.jpg');
      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      // The row is authoritative: a reference added between the pre-check and
      // here must be caught before any file is touched, not after (see the
      // findings this ordering fixes — storage deleted before the final
      // recheck could leave a live reference pointing at a 404).
      expect(order(prisma.media.delete)).toBeLessThan(order(variants.deleteR2Variants));
      expect(order(variants.deleteR2Variants)).toBeLessThan(order(r2.deleteObject));
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'media-1' }));
      expect(result.message).toBe('Media deleted');
    });

    it('treats a file that is already gone as deleted (a legacy row whose original never reached R2)', async () => {
      r2.deleteObject.mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));

      await expect(service.delete('media-1', 'user-1')).resolves.toMatchObject({ message: 'Media deleted' });
      expect(prisma.media.delete).toHaveBeenCalled();
    });

    it('still succeeds, and logs it, when the original cannot be deleted after the row is already gone', async () => {
      r2.deleteObject.mockRejectedValue(new Error('R2 unavailable'));

      const result = await service.delete('media-1', 'user-1');

      // The row was already deleted (and audited) before storage was ever
      // touched — a storage failure now only orphans a blob, which is
      // logged for follow-up, not surfaced as a request failure.
      expect(result.message).toBe('Media deleted');
      expect(prisma.media.delete).toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'media-1' }));
    });

    it('still succeeds when a variant cannot be deleted, and skips the original delete attempt', async () => {
      variants.deleteR2Variants.mockResolvedValue(['media/variants/media-1/w768.webp']);

      const result = await service.delete('media-1', 'user-1');

      expect(result.message).toBe('Media deleted');
      expect(r2.deleteObject).not.toHaveBeenCalled();
      expect(prisma.media.delete).toHaveBeenCalled();
    });

    it('a media id whose row was already deleted answers 404, not a storage error', async () => {
      // Unlike the old "storage first" design, there is no "retry the same
      // delete" concept any more — once the row is gone, a repeat call finds
      // nothing to delete. Confirms findUnique's NotFoundException path
      // still fires first, before any storage call, on a second attempt.
      prisma.media.findUnique.mockResolvedValueOnce(baseMedia).mockResolvedValueOnce(null);

      await service.delete('media-1', 'user-1');
      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.media.delete).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when media is referenced by posts, without touching storage', async () => {
      prisma.posts.count.mockResolvedValue(2);
      prisma.posts.findMany.mockResolvedValue([
        { id: 'post-1', deleted_at: null },
        { id: 'post-2', deleted_at: new Date() },
      ]);

      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(prisma.media.delete).not.toHaveBeenCalled();
      expect(variants.deleteR2Variants).not.toHaveBeenCalled();
      expect(r2.deleteObject).not.toHaveBeenCalled();
    });

    it('throws ConflictException when media is referenced by gallery_images', async () => {
      prisma.gallery_images.count.mockResolvedValue(1);
      prisma.gallery_images.findMany.mockResolvedValue([{ media_id: 'media-1', deleted_at: null }]);

      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when media is referenced only by a book/paper/page og:image', async () => {
      // Regression guard: these three og_image_id FKs were previously
      // uncounted, so deleting a media used only as a book/paper/page OG image
      // passed the guard and the FK silently SET NULL'd the SEO image.
      prisma.book_translations.count.mockResolvedValue(1);
      prisma.book_translations.findMany.mockResolvedValue([{ book_id: 'book-1', lang: 'ar', books: { deleted_at: null } }]);

      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(prisma.media.delete).not.toHaveBeenCalled();
    });

    it('explains the 409: code, the referencing resources with trashed flags, and a pointer to the full list (B-Med2)', async () => {
      prisma.posts.count.mockResolvedValue(1);
      prisma.posts.findMany.mockResolvedValue([{ id: 'post-live', deleted_at: null }]);
      prisma.book_translations.count.mockResolvedValue(1);
      prisma.book_translations.findMany.mockResolvedValue([
        { book_id: 'book-trashed', lang: 'ar', books: { deleted_at: new Date() } },
      ]);

      const body = await conflictBody();

      expect(body.code).toBe('MEDIA_IN_USE');
      expect(body.message).toContain('referenced by 2 records');
      expect(body.message).toContain('post post-live (cover_image)');
      expect(body.message).toContain('book book-trashed (og_image, ar), in the trash');
      expect(body.message).toContain('GET /media/media-1/references');
      expect(body.details).toEqual({
        total: 2,
        shown: 2,
        truncated: false,
        references: [
          { type: 'post', id: 'post-live', field: 'cover_image', trashed: false },
          { type: 'book', id: 'book-trashed', field: 'og_image', lang: 'ar', trashed: true },
        ],
      });
    });

    it('tells the editor that a gallery item IS the media (it uses the media id as its primary key)', async () => {
      prisma.gallery_images.count.mockResolvedValue(1);
      prisma.gallery_images.findMany.mockResolvedValue([{ media_id: 'media-1', deleted_at: null }]);

      const body = await conflictBody();

      expect(body.message).toContain('gallery_image media-1 (gallery_item)');
      expect(body.message).toContain('uses the media id as its own id');
    });

    it('caps what it lists but reports the real total', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({ id: `post-${i}`, deleted_at: null }));
      prisma.posts.findMany.mockResolvedValue(rows);
      prisma.posts.count.mockResolvedValue(45);

      const body = await conflictBody();

      expect(body.details.total).toBe(45);
      expect(body.details.shown).toBe(20);
      expect(body.details.truncated).toBe(true);
      expect(body.details.references).toHaveLength(20);
      // Only the first few are spelled out in the message.
      expect(body.message).toContain('referenced by 45 records');
      expect(body.message).toContain(', and 40 more');
      expect(body.message).not.toContain('post-6');
    });

    it('catches a reference that appears while the storage calls were in flight, before the row goes', async () => {
      // Pre-check sees nothing; the in-transaction re-check finds a fresh cover reference.
      prisma.posts.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      prisma.posts.findMany.mockResolvedValue([{ id: 'post-new', deleted_at: null }]);

      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(ConflictException);

      expect(prisma.media.delete).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when media not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.delete('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findReferences (B-Med2)', () => {
    it('throws NotFoundException when the media does not exist', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.findReferences('ghost')).rejects.toThrow(NotFoundException);
    });

    it('returns an empty list for an unused media', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-1' });

      const { data } = await service.findReferences('media-1');

      expect(data).toEqual({ media_id: 'media-1', total: 0, shown: 0, truncated: false, items: [] });
    });

    it('lists every kind of reference, live or trashed, with the id of the resource that holds it', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-1' });
      const trashedAt = new Date();
      prisma.posts.findMany.mockResolvedValue([{ id: 'p1', deleted_at: null }]);
      prisma.post_attachments.findMany.mockResolvedValue([{ post_id: 'p2', posts: { deleted_at: trashedAt } }]);
      prisma.post_translations.findMany.mockResolvedValue([{ post_id: 'p3', lang: 'en', posts: { deleted_at: null } }]);
      prisma.books.findMany.mockResolvedValue([{ id: 'b1', deleted_at: trashedAt }]);
      prisma.book_translations.findMany.mockResolvedValue([{ book_id: 'b2', lang: 'ar', books: { deleted_at: null } }]);
      prisma.static_page_translations.findMany.mockResolvedValue([
        { page_id: 's1', lang: 'ar', static_pages: { deleted_at: null } },
      ]);
      prisma.gallery_images.findMany.mockResolvedValue([{ media_id: 'media-1', deleted_at: null }]);
      prisma.gallery_image_translations.findMany.mockResolvedValue([
        { media_id: 'g2', lang: 'ar', gallery_images: { deleted_at: trashedAt } },
      ]);

      const { data } = await service.findReferences('media-1');

      expect(data.total).toBe(8);
      expect(data.truncated).toBe(false);
      expect(data.items).toEqual([
        { type: 'post', id: 'p1', field: 'cover_image', trashed: false },
        { type: 'post', id: 'p2', field: 'attachment', trashed: true },
        { type: 'post', id: 'p3', field: 'og_image', lang: 'en', trashed: false },
        { type: 'book', id: 'b1', field: 'cover_image', trashed: true },
        { type: 'book', id: 'b2', field: 'og_image', lang: 'ar', trashed: false },
        { type: 'static_page', id: 's1', field: 'og_image', lang: 'ar', trashed: false },
        { type: 'gallery_image', id: 'media-1', field: 'gallery_item', trashed: false },
        { type: 'gallery_image', id: 'g2', field: 'og_image', lang: 'ar', trashed: true },
      ]);
    });

    it('queries every table that has a foreign key into media (none can be forgotten)', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-1' });

      await service.findReferences('media-1');

      for (const table of REFERENCE_TABLES) {
        expect(prisma[table].findMany).toHaveBeenCalledTimes(1);
      }
    });

    it('caps the list at 20 and reports the real total', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-1' });
      prisma.posts.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, deleted_at: null })));
      prisma.posts.count.mockResolvedValue(31);
      prisma.books.findMany.mockResolvedValue([{ id: 'b1', deleted_at: null }]);

      const { data } = await service.findReferences('media-1');

      expect(data.total).toBe(32);
      expect(data.shown).toBe(20);
      expect(data.truncated).toBe(true);
      expect(data.items).toHaveLength(20);
    });
  });
});
