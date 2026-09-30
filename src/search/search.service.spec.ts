import { SearchService } from './search.service';
import { SearchResourceType } from './dto/search.dto';
import { MEDIA_URL_WITH_VARIANTS_SELECT } from '../common/crud/media-selects';
import { setActiveLanguages } from '../common/utils/translation.util';

const variants = [
  { id: 'v1', width: 320, url: 'https://cdn.example.com/v/320.webp', format: 'webp' },
  { id: 'v2', width: 768, url: 'https://cdn.example.com/v/768.webp', format: 'webp' },
];

describe('SearchService', () => {
  let prisma: any;
  let service: SearchService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      posts: { findMany: jest.fn() },
      books: { findMany: jest.fn() },
      academic_papers: { findMany: jest.fn() },
      gallery_images: { findMany: jest.fn() },
      audios: { findMany: jest.fn() },
    };
    service = new SearchService(prisma);
  });

  afterEach(() => setActiveLanguages(null));

  const search = (type: SearchResourceType, lang: string | null = 'ar') =>
    service.search({ q: 'imam', limit: 10, types: [type] }, lang);

  describe('cover image variants (B-Med8)', () => {
    it('asks for the original url AND the ordered variants of every embedded cover', async () => {
      prisma.$queryRaw.mockResolvedValue([{ post_id: 'p1', score: 0.9 }]);
      prisma.posts.findMany.mockResolvedValue([]);

      await search(SearchResourceType.Post);

      expect(prisma.posts.findMany.mock.calls[0][0].select.media).toEqual({ select: MEDIA_URL_WITH_VARIANTS_SELECT });
      expect(MEDIA_URL_WITH_VARIANTS_SELECT).toEqual({
        url: true,
        media_variants: {
          select: { id: true, width: true, url: true, format: true },
          orderBy: { width: 'asc' },
        },
      });
    });

    it('a post hit keeps cover_image_url and gains cover_image_variants', async () => {
      prisma.$queryRaw.mockResolvedValue([{ post_id: 'p1', score: 0.9 }]);
      prisma.posts.findMany.mockResolvedValue([
        {
          id: 'p1',
          slug: 'a-post',
          post_translations: [{ lang: 'ar', title: 'الإمام', summary: 's', body: 'x', is_default: true }],
          media: { url: 'https://cdn.example.com/o.jpg', media_variants: variants },
        },
      ]);

      const { data } = await search(SearchResourceType.Post);

      expect(data.post!.items[0]).toEqual({
        type: 'post',
        id: 'p1',
        title: 'الإمام',
        summary: 's',
        lang: 'ar',
        slug: 'a-post',
        cover_image_url: 'https://cdn.example.com/o.jpg',
        cover_image_variants: variants,
      });
    });

    it('a hit without an image has an empty variants array, not a missing key', async () => {
      prisma.$queryRaw.mockResolvedValue([{ post_id: 'p1', score: 0.9 }]);
      prisma.posts.findMany.mockResolvedValue([
        {
          id: 'p1',
          slug: null,
          post_translations: [{ lang: 'ar', title: 'الإمام', summary: null, body: '', is_default: true }],
          media: null,
        },
      ]);

      const { data } = await search(SearchResourceType.Post);

      expect(data.post!.items[0]).toMatchObject({ cover_image_url: null, cover_image_variants: [] });
    });

    it('book and gallery hits carry their variants; paper and audio hits have none', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ book_id: 'b1', score: 1 }])
        .mockResolvedValueOnce([{ paper_id: 'pp1', score: 1 }])
        .mockResolvedValueOnce([{ media_id: 'g1', score: 1 }])
        .mockResolvedValueOnce([{ id: 'a1', score: 1 }]);
      prisma.books.findMany.mockResolvedValue([
        {
          id: 'b1',
          slug: 'book',
          book_translations: [{ lang: 'ar', title: 'imam', author: null, description: null, is_default: true }],
          media: { url: 'https://cdn.example.com/b.jpg', media_variants: variants },
        },
      ]);
      prisma.academic_papers.findMany.mockResolvedValue([
        { id: 'pp1', academic_paper_translations: [{ lang: 'ar', title: 'imam', abstract: null, is_default: true }] },
      ]);
      prisma.gallery_images.findMany.mockResolvedValue([
        {
          media_id: 'g1',
          gallery_image_translations: [{ lang: 'ar', title: 'imam', description: null, is_default: true }],
          media: { url: 'https://cdn.example.com/g.jpg', media_variants: variants },
        },
      ]);
      prisma.audios.findMany.mockResolvedValue([
        {
          id: 'a1',
          slug: 'audio',
          audio_translations: [{ lang: 'ar', title: 'imam', is_default: true }],
          speakers: null,
        },
      ]);

      const { data } = await service.search(
        {
          q: 'imam',
          limit: 10,
          types: [SearchResourceType.Book, SearchResourceType.AcademicPaper, SearchResourceType.GalleryImage, SearchResourceType.Audio],
        },
        'ar',
      );

      expect(data.book!.items[0]).toMatchObject({ cover_image_variants: variants });
      expect(data.gallery_image!.items[0]).toMatchObject({ cover_image_variants: variants });
      expect(data.academic_paper!.items[0]).toMatchObject({ cover_image_url: null, cover_image_variants: [] });
      expect(data.audio!.items[0]).toMatchObject({ cover_image_url: null, cover_image_variants: [] });
      expect(prisma.books.findMany.mock.calls[0][0].select.media).toEqual({ select: MEDIA_URL_WITH_VARIANTS_SELECT });
      expect(prisma.gallery_images.findMany.mock.calls[0][0].select.media).toEqual({ select: MEDIA_URL_WITH_VARIANTS_SELECT });
    });
  });

  describe('retired languages (S24)', () => {
    const post = (translations: any[]) => ({ id: 'p1', slug: 's', post_translations: translations, media: null });

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ post_id: 'p1', score: 0.9 }]);
    });

    it('a translation in a retired language is not shown even when it is the one that matched', async () => {
      setActiveLanguages(['ar']);
      prisma.posts.findMany.mockResolvedValue([
        post([
          { lang: 'ar', title: 'عنوان', summary: null, body: '', is_default: true },
          { lang: 'fa', title: 'imam farsi', summary: null, body: '', is_default: false },
        ]),
      ]);

      const { data } = await search(SearchResourceType.Post, 'fa');

      expect(data.post!.items).toHaveLength(1);
      expect(data.post!.items[0]).toMatchObject({ lang: 'ar', title: 'عنوان' });
    });

    it('a hit whose only translations are in a retired language is dropped', async () => {
      setActiveLanguages(['ar']);
      prisma.posts.findMany.mockResolvedValue([
        post([{ lang: 'fa', title: 'imam farsi', summary: null, body: '', is_default: true }]),
      ]);

      const { data } = await search(SearchResourceType.Post, 'fa');

      expect(data.post).toEqual({ items: [], total: 0 });
    });

    it('nothing is dropped while no language snapshot is loaded', async () => {
      prisma.posts.findMany.mockResolvedValue([
        post([{ lang: 'fa', title: 'imam farsi', summary: null, body: '', is_default: true }]),
      ]);

      const { data } = await search(SearchResourceType.Post, 'fa');

      expect(data.post!.items).toHaveLength(1);
      expect(data.post!.items[0]).toMatchObject({ lang: 'fa' });
    });
  });

  describe('audio speaker (trashed speakers)', () => {
    const audio = (speakers: unknown) => ({
      id: 'a1',
      slug: 'audio',
      audio_translations: [{ lang: 'ar', title: 'imam', is_default: true }],
      speakers,
    });
    const speaker = (deleted_at: Date | null) => ({
      deleted_at,
      speaker_translations: [{ lang: 'ar', name: 'الشيخ', is_default: true }],
    });

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'a1', score: 1 }]);
    });

    it('the SQL only joins live speakers, so a trashed speaker name can never match', async () => {
      prisma.audios.findMany.mockResolvedValue([]);

      await search(SearchResourceType.Audio);

      const sql = (prisma.$queryRaw.mock.calls[0][0] as { sql: string }).sql.replace(/\s+/g, ' ');
      expect(sql).toContain('LEFT JOIN speakers s ON s.id = a.speaker_id AND s.deleted_at IS NULL');
      expect(sql).toContain('LEFT JOIN speaker_translations sp ON sp.speaker_id = s.id');
      expect(sql).not.toContain('sp.speaker_id = a.speaker_id');
    });

    it('the follow-up read fetches the speaker deleted_at flag', async () => {
      prisma.audios.findMany.mockResolvedValue([]);

      await search(SearchResourceType.Audio);

      expect(prisma.audios.findMany.mock.calls[0][0].select.speakers).toEqual({
        select: { deleted_at: true, speaker_translations: { select: { lang: true, name: true, is_default: true } } },
      });
    });

    it('a live speaker is named in the summary', async () => {
      prisma.audios.findMany.mockResolvedValue([audio(speaker(null))]);

      const { data } = await search(SearchResourceType.Audio);

      expect(data.audio!.items[0]).toMatchObject({ id: 'a1', title: 'imam', summary: 'الشيخ' });
    });

    it('a trashed speaker is not named: the audio still matches on its own title, with no summary', async () => {
      prisma.audios.findMany.mockResolvedValue([audio(speaker(new Date('2026-01-01T00:00:00Z')))]);

      const { data } = await search(SearchResourceType.Audio);

      expect(data.audio!.items).toHaveLength(1);
      expect(data.audio!.items[0]).toMatchObject({ id: 'a1', title: 'imam', summary: null });
    });

    it('an audio without a speaker has no summary', async () => {
      prisma.audios.findMany.mockResolvedValue([audio(null)]);

      const { data } = await search(SearchResourceType.Audio);

      expect(data.audio!.items[0]).toMatchObject({ summary: null });
    });
  });
});
