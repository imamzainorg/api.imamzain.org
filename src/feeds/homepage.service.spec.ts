import { HomepageService } from './homepage.service';
import { MEDIA_URL_WITH_VARIANTS_SELECT } from '../common/crud/media-selects';
import { setActiveLanguages } from '../common/utils/translation.util';

const variants = [
  { id: 'v1', width: 320, url: 'https://cdn.example.com/v/320.webp', format: 'webp' },
  { id: 'v2', width: 768, url: 'https://cdn.example.com/v/768.webp', format: 'webp' },
];

describe('HomepageService', () => {
  let prisma: any;
  let hadiths: { getToday: jest.Mock };
  let youtube: { findRecentVideos: jest.Mock };
  let service: HomepageService;

  beforeEach(() => {
    prisma = {
      posts: { findMany: jest.fn().mockResolvedValue([]) },
      books: { findMany: jest.fn().mockResolvedValue([]) },
      gallery_images: { findMany: jest.fn().mockResolvedValue([]) },
      gallery_categories: { findMany: jest.fn().mockResolvedValue([]) },
    };
    hadiths = { getToday: jest.fn().mockResolvedValue({ data: null }) };
    youtube = { findRecentVideos: jest.fn().mockResolvedValue([]) };
    service = new HomepageService(prisma, hadiths as any, youtube as any);
  });

  afterEach(() => setActiveLanguages(null));

  describe('image variants (B-Med8)', () => {
    it('every embedded image is selected with its ordered variants next to the url', async () => {
      await service.getHomepage('ar');

      const shape = { select: MEDIA_URL_WITH_VARIANTS_SELECT };
      expect(prisma.posts.findMany.mock.calls[0][0].select.media).toEqual(shape);
      expect(prisma.books.findMany.mock.calls[0][0].select.media).toEqual(shape);
      expect(prisma.gallery_images.findMany.mock.calls[0][0].include.media).toEqual(shape);
    });

    it('news and publications keep `image` and add `image_variants`', async () => {
      prisma.posts.findMany.mockResolvedValue([
        {
          slug: 'a-post',
          post_translations: [{ lang: 'ar', is_default: true, title: 'عنوان', summary: 'ملخص' }],
          media: { url: 'https://cdn.example.com/p.jpg', media_variants: variants },
        },
      ]);
      prisma.books.findMany.mockResolvedValue([
        {
          id: 'b1',
          slug: null,
          pages: 10,
          views: 5n,
          book_translations: [{ lang: 'ar', is_default: true, title: 'كتاب' }],
          media: { url: 'https://cdn.example.com/b.jpg', media_variants: variants },
        },
      ]);

      const { data } = await service.getHomepage('ar');

      expect(data.news).toEqual([
        { slug: 'a-post', image: 'https://cdn.example.com/p.jpg', image_variants: variants, summary: 'ملخص', title: 'عنوان' },
      ]);
      expect(data.publications).toEqual([
        { id: 'b1', slug: 'b1', title: 'كتاب', image: 'https://cdn.example.com/b.jpg', image_variants: variants, pages: 10, views: 5 },
      ]);
    });

    it('the gallery slider keeps `path` and adds `path_variants`', async () => {
      prisma.gallery_images.findMany.mockResolvedValue([
        { media_id: 'g1', media: { url: 'https://cdn.example.com/g.jpg', media_variants: variants } },
      ]);

      const { data } = await service.getHomepage('ar');

      expect(data.gallery.slider).toEqual([{ id: 'g1', path: 'https://cdn.example.com/g.jpg', path_variants: variants }]);
    });

    it('an item with no image gets a null url and an empty variants array', async () => {
      prisma.posts.findMany.mockResolvedValue([
        { slug: 's', post_translations: [{ lang: 'ar', is_default: true, title: 't', summary: null }], media: null },
      ]);
      prisma.books.findMany.mockResolvedValue([
        { id: 'b1', slug: 's', pages: null, views: 0n, book_translations: [{ lang: 'ar', is_default: true, title: 't' }], media: null },
      ]);
      prisma.gallery_images.findMany.mockResolvedValue([{ media_id: 'g1', media: null }]);

      const { data } = await service.getHomepage('ar');

      expect(data.news[0]).toMatchObject({ image: null, image_variants: [] });
      expect(data.publications[0]).toMatchObject({ image: null, image_variants: [] });
      expect(data.gallery.slider[0]).toEqual({ id: 'g1', path: null, path_variants: [] });
    });
  });

  describe('translation resolution', () => {
    it('gallery category names use a deterministic fallback (no is_default column there)', async () => {
      const cat = (id: string, langs: string[]) => ({
        id,
        gallery_category_translations: langs.map((lang) => ({ lang, title: `t-${lang}` })),
      });
      prisma.gallery_categories.findMany.mockResolvedValue([cat('c1', ['fa', 'en', 'ar']), cat('c2', ['ar', 'fa', 'en']), cat('c3', ['fa', 'en'])]);

      const { data } = await service.getHomepage('fr');

      expect(data.gallery.categories.map((c: any) => c.name)).toEqual(['t-ar', 't-ar', 't-en']);
    });

    it('never shows a category name in a retired language (S24)', async () => {
      setActiveLanguages(['ar', 'en']);
      prisma.gallery_categories.findMany.mockResolvedValue([
        { id: 'c1', gallery_category_translations: [{ lang: 'fa', title: 'فارسی' }, { lang: 'en', title: 'English' }] },
      ]);

      const { data } = await service.getHomepage('fa');

      expect(data.gallery.categories).toEqual([{ id: 'c1', name: 'English' }]);
    });
  });

  describe('videos (B-YT2)', () => {
    it('reads the foundation-only recent list from the YouTube service', async () => {
      youtube.findRecentVideos.mockResolvedValue([
        { title: 'V', video_id: 'abc', description: 'd', thumbnail_url: 'u', published_at: new Date('2026-01-02T00:00:00Z') },
      ]);

      const { data } = await service.getHomepage(null);

      expect(youtube.findRecentVideos).toHaveBeenCalledWith(7);
      expect(data.videos).toEqual([
        { title: 'V', url: 'abc', desc: 'd', thumbnail: 'u', date: '2026-01-02T00:00:00.000Z' },
      ]);
    });
  });
});
