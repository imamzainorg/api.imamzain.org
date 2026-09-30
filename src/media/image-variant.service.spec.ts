import sharp from 'sharp';
import { ImageVariantService } from './image-variant.service';

// Fixtures are built with sharp inside the spec — no binary files in the repo.
const GPS = {
  GPSLatitudeRef: 'N',
  GPSLatitude: '36/1 20/1 0/1',
  GPSLongitudeRef: 'E',
  GPSLongitude: '44/1 0/1 0/1',
};

interface FixtureOptions {
  orientation?: number;
  withExif?: boolean;
  format?: 'jpeg' | 'png' | 'webp';
}

async function photo(width: number, height: number, opts: FixtureOptions = {}): Promise<Buffer> {
  const { orientation, withExif = true, format = 'jpeg' } = opts;
  let img = sharp({ create: { width, height, channels: 3, background: { r: 180, g: 60, b: 40 } } });
  if (orientation) img = img.withMetadata({ orientation });
  if (withExif) img = img.withExif({ IFD0: { Make: 'TestCam' }, IFD3: GPS });
  return img[format]().toBuffer();
}

async function animatedGif(size: number): Promise<Buffer> {
  const frame = (background: string) =>
    sharp({ create: { width: size, height: size, channels: 3, background } }).png().toBuffer();
  return sharp([await frame('#ff0000'), await frame('#0000ff')], { join: { animated: true } })
    .gif({ delay: [100, 100] })
    .toBuffer();
}

const KEY = 'media/originals/11111111-2222-4333-8444-555555555555/photo.jpg';
const ID = '11111111-2222-4333-8444-555555555555';

describe('ImageVariantService', () => {
  let r2: {
    getObjectBuffer: jest.Mock;
    headObject: jest.Mock;
    putObjectBuffer: jest.Mock;
    variantKey: jest.Mock;
    deleteObject: jest.Mock;
  };
  let prisma: { media: { updateMany: jest.Mock }; media_variants: { upsert: jest.Mock; findMany: jest.Mock } };
  let service: ImageVariantService;

  /** PUTs to the original key only (not the variant keys). */
  const originalPuts = () => r2.putObjectBuffer.mock.calls.filter(([key]) => key === KEY);
  const variantPuts = () => r2.putObjectBuffer.mock.calls.filter(([key]) => String(key).includes('/variants/'));

  beforeEach(() => {
    r2 = {
      getObjectBuffer: jest.fn(),
      headObject: jest.fn().mockResolvedValue({
        contentType: 'image/jpeg',
        contentLength: 1,
        cacheControl: 'public, max-age=31536000, immutable',
      }),
      putObjectBuffer: jest.fn().mockImplementation(async (key: string) => `https://cdn.imamzain.org/${key}`),
      variantKey: jest.fn((id: string, w: number) => `media/variants/${id}/w${w}.webp`),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      media: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      media_variants: {
        upsert: jest.fn().mockImplementation(async ({ create }: any) => ({ id: `v${create.width}`, ...create })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new ImageVariantService(prisma as any, r2 as any);
  });

  describe('processMedia — outcomes', () => {
    it('reports original_missing when storage says the key does not exist', async () => {
      r2.getObjectBuffer.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NoSuchKey' }));

      const pass = await service.processMedia({ id: ID }, KEY);

      expect(pass).toEqual({ outcome: 'original_missing', variants: [], mediaPatch: {}, sanitized: false });
      expect(prisma.media.updateMany).not.toHaveBeenCalled();
    });

    it('reports a plain error (not "missing") for any other storage failure', async () => {
      r2.getObjectBuffer.mockRejectedValue(new Error('socket hang up'));

      expect((await service.processMedia({ id: ID }, KEY)).outcome).toBe('error');
    });

    it('reports unreadable for bytes sharp cannot decode', async () => {
      r2.getObjectBuffer.mockResolvedValue(Buffer.from('definitely not an image'));

      expect((await service.processMedia({ id: ID }, KEY)).outcome).toBe('unreadable');
    });

    it('reports non_raster for a decodable format outside jpeg/png/webp/gif', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>');
      r2.getObjectBuffer.mockResolvedValue(svg);

      const pass = await service.processMedia({ id: ID }, KEY);

      expect(pass.outcome).toBe('non_raster');
      expect(r2.putObjectBuffer).not.toHaveBeenCalled();
    });
  });

  describe('processMedia — dimensions (B-Med4)', () => {
    it('corrects a sideways client-declared size to the EXIF-oriented one and says so in the patch', async () => {
      // Stored landscape 200x100 with orientation 6 => displayed 100x200. The client declared the stored size.
      r2.getObjectBuffer.mockResolvedValue(await photo(200, 100, { orientation: 6, withExif: false }));

      const pass = await service.processMedia({ id: ID, width: 200, height: 100 }, KEY);

      expect(prisma.media.updateMany).toHaveBeenCalledWith({ where: { id: ID }, data: { width: 100, height: 200 } });
      // (orientation itself lives in EXIF, so this file is also rewritten upright — see the S19 specs)
      expect(pass.mediaPatch).toMatchObject({ width: 100, height: 200 });
    });

    it('does not touch the row when the stored size is already right', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(200, 100, { withExif: false }));

      const pass = await service.processMedia({ id: ID, width: 200, height: 100 }, KEY);

      expect(prisma.media.updateMany).not.toHaveBeenCalled();
      expect(pass.mediaPatch).toEqual({});
    });

    it('fills in dimensions the client never sent', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(200, 100, { withExif: false }));

      await service.processMedia({ id: ID, width: null, height: null }, KEY);

      expect(prisma.media.updateMany).toHaveBeenCalledWith({ where: { id: ID }, data: { width: 200, height: 100 } });
    });

    it('never plans or writes a variant wider than the real (oriented) image', async () => {
      // Stored 1500x400 with orientation 6 => displayed 400x1500. Judged by the stored width (1500) the old
      // code would have made 320, 768 and 1280 px variants; only 320 is narrower than the real 400 px width.
      r2.getObjectBuffer.mockResolvedValue(await photo(1500, 400, { orientation: 6, withExif: false }));

      const pass = await service.processMedia({ id: ID, width: 1500, height: 400 }, KEY);

      expect(pass.variants.map((v) => v.width)).toEqual([320]);
      expect(variantPuts()).toHaveLength(1);
      const written = await sharp(variantPuts()[0][1]).metadata();
      expect(written.width).toBe(320);
      expect(written.format).toBe('webp');
    });

    it('makes no variants for an original that is not wider than the smallest width', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(300, 200, { withExif: false }));

      const pass = await service.processMedia({ id: ID, width: 300, height: 200 }, KEY);

      expect(pass.outcome).toBe('ok');
      expect(pass.variants).toEqual([]);
      expect(prisma.media_variants.upsert).not.toHaveBeenCalled();
    });
  });

  describe('processMedia — animated images (B-Med7)', () => {
    it('detects an animated GIF, generates no variants and leaves the original alone', async () => {
      r2.getObjectBuffer.mockResolvedValue(await animatedGif(400));

      const pass = await service.processMedia({ id: ID, width: 400, height: 400 }, KEY);

      expect(pass.outcome).toBe('animated');
      expect(pass.variants).toEqual([]);
      expect(pass.sanitized).toBe(false);
      expect(r2.putObjectBuffer).not.toHaveBeenCalled();
      expect(prisma.media_variants.upsert).not.toHaveBeenCalled();
    });

    it('still makes variants for a static GIF wide enough to need them', async () => {
      const staticGif = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#00aa00' } }).gif().toBuffer();
      r2.getObjectBuffer.mockResolvedValue(staticGif);

      const pass = await service.processMedia({ id: ID, width: 400, height: 300 }, KEY);

      expect(pass.outcome).toBe('ok');
      expect(pass.variants.map((v) => v.width)).toEqual([320]);
    });
  });

  describe('processMedia — original metadata stripping (S19)', () => {
    it('rewrites a photo that carries GPS/EXIF: same format, no metadata, orientation baked in, same headers', async () => {
      const source = await photo(64, 32, { orientation: 6 });
      const before = await sharp(source).metadata();
      expect(before.exif).toBeDefined();
      expect(before.orientation).toBe(6);
      r2.getObjectBuffer.mockResolvedValue(source);

      const pass = await service.processMedia({ id: ID, width: 64, height: 32 }, KEY);

      expect(pass.sanitized).toBe(true);
      expect(originalPuts()).toHaveLength(1);
      const [, cleaned, contentType, cacheControl] = originalPuts()[0];
      expect(contentType).toBe('image/jpeg');
      expect(cacheControl).toBe('public, max-age=31536000, immutable');

      const after = await sharp(cleaned).metadata();
      expect(after.format).toBe('jpeg');
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.iptc).toBeUndefined();
      expect(after.orientation).toBeUndefined();
      // Stored 64x32 + orientation 6 is displayed 32x64; the rewrite stores it that way up.
      expect({ width: after.width, height: after.height }).toEqual({ width: 32, height: 64 });
      expect((cleaned as Buffer).includes(Buffer.from('Exif'))).toBe(false);

      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: ID },
        data: { file_size: (cleaned as Buffer).length },
      });
      expect(pass.mediaPatch).toEqual({ width: 32, height: 64, file_size: BigInt((cleaned as Buffer).length) });
    });

    it('rewrites PNG and WebP originals in their own format too', async () => {
      for (const format of ['png', 'webp'] as const) {
        r2.putObjectBuffer.mockClear();
        r2.headObject.mockResolvedValue({ contentType: `image/${format}`, cacheControl: undefined });
        r2.getObjectBuffer.mockResolvedValue(await photo(50, 40, { format }));

        const pass = await service.processMedia({ id: ID, width: 50, height: 40 }, KEY);

        expect(pass.sanitized).toBe(true);
        const [, cleaned, contentType] = originalPuts()[0];
        expect(contentType).toBe(`image/${format}`);
        const after = await sharp(cleaned).metadata();
        expect(after.format).toBe(format);
        expect(after.exif).toBeUndefined();
      }
    });

    it('sends no Cache-Control when the object had none', async () => {
      r2.headObject.mockResolvedValue({ contentType: 'image/jpeg', cacheControl: undefined });
      r2.getObjectBuffer.mockResolvedValue(await photo(64, 32));

      await service.processMedia({ id: ID, width: 64, height: 32 }, KEY);

      expect(originalPuts()[0][3]).toBeUndefined();
    });

    it('leaves an image with no EXIF/XMP/IPTC completely alone (no re-encode, no PUT)', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(64, 32, { withExif: false }));

      const pass = await service.processMedia({ id: ID, width: 64, height: 32 }, KEY);

      expect(pass.sanitized).toBe(false);
      expect(originalPuts()).toHaveLength(0);
    });

    it('strips an original that is too small for variants — privacy does not depend on size', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(120, 80));

      const pass = await service.processMedia({ id: ID, width: 120, height: 80 }, KEY);

      expect(pass.variants).toEqual([]);
      expect(pass.sanitized).toBe(true);
    });

    it('keeps the original untouched (and still makes variants) when the overwrite fails', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(400, 300));
      r2.putObjectBuffer.mockImplementation(async (key: string) => {
        if (key === KEY) throw new Error('R2 unavailable');
        return `https://cdn.imamzain.org/${key}`;
      });

      const pass = await service.processMedia({ id: ID, width: 400, height: 300 }, KEY);

      expect(pass.sanitized).toBe(false);
      expect(pass.mediaPatch.file_size).toBeUndefined();
      expect(pass.variants.map((v) => v.width)).toEqual([320]);
      expect(prisma.media.updateMany).not.toHaveBeenCalledWith({ where: { id: ID }, data: expect.objectContaining({ file_size: expect.anything() }) });
    });

    it('keeps the original untouched when its headers cannot be read (cannot preserve Content-Type)', async () => {
      r2.headObject.mockResolvedValue(null);
      r2.getObjectBuffer.mockResolvedValue(await photo(64, 32));

      const pass = await service.processMedia({ id: ID, width: 64, height: 32 }, KEY);

      expect(pass.sanitized).toBe(false);
      expect(originalPuts()).toHaveLength(0);
    });

    it('a row deleted mid-pass does not fail the pass: the file_size update is best effort', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(64, 32));
      prisma.media.updateMany.mockRejectedValue(new Error('connection lost'));

      const pass = await service.processMedia({ id: ID, width: 64, height: 32 }, KEY);

      // The overwrite already happened; only the bookkeeping failed.
      expect(originalPuts()).toHaveLength(1);
      expect(pass.outcome).toBe('ok');
    });
  });

  describe('generateForMedia (backfill script compatibility)', () => {
    it('returns just the rows and never rewrites the original in the bucket', async () => {
      r2.getObjectBuffer.mockResolvedValue(await photo(400, 300));

      const rows = await service.generateForMedia(ID, KEY);

      expect(rows.map((r) => r.width)).toEqual([320]);
      expect(originalPuts()).toHaveLength(0);
    });
  });

  describe('probeDimensions', () => {
    it('reads the displayed size from the header bytes alone', async () => {
      const source = await photo(600, 300, { orientation: 6 });
      const sos = source.indexOf(Buffer.from([0xff, 0xda]));
      expect(sos).toBeGreaterThan(0);

      // Everything up to and a little past the start-of-scan marker — the header, without the pixel data.
      const probed = await service.probeDimensions(source.subarray(0, sos + 12));

      expect(probed).toEqual({ width: 300, height: 600 });
    });

    it('returns null when the bytes are not an image header', async () => {
      expect(await service.probeDimensions(Buffer.from('<html></html>'))).toBeNull();
    });
  });

  describe('deleteR2Variants', () => {
    it('counts an already-missing variant as deleted and reports only genuine failures', async () => {
      r2.deleteObject.mockImplementation(async (key: string) => {
        if (key.endsWith('w320.webp')) throw Object.assign(new Error('gone'), { name: 'NoSuchKey' });
        if (key.endsWith('w768.webp')) throw new Error('R2 unavailable');
      });

      const failed = await service.deleteR2Variants(ID);

      expect(failed).toEqual([`media/variants/${ID}/w768.webp`]);
      expect(r2.deleteObject).toHaveBeenCalledTimes(4);
    });

    it('returns an empty list when every delete succeeds', async () => {
      expect(await service.deleteR2Variants(ID)).toEqual([]);
    });
  });
});
