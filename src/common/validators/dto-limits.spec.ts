import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

import { CreateAcademicPaperCategoryDto } from '../../academic-paper-categories/dto/academic-paper-category.dto';
import { CreateAcademicPaperDto, UpdateAcademicPaperDto, AcademicPaperQueryDto } from '../../academic-papers/dto/academic-paper.dto';
import { AudioAdminQueryDto, AudioQueryDto, CreateAudioDto, UpdateAudioDto } from '../../audios/dto/audio.dto';
import { CreateBookCategoryDto } from '../../book-categories/dto/book-category.dto';
import { BookQueryDto, CreateBookDto, UpdateBookDto } from '../../books/dto/book.dto';
import { StartContestDto, SubmitAnswerDto, SubmitContestDto } from '../../contest/dto/contest.dto';
import { CreateDailyHadithDto, UpdateDailyHadithDto } from '../../daily-hadiths/dto/daily-hadith.dto';
import { CreateContactDto, UpdateContactDto } from '../../forms/dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from '../../forms/dto/proxy-visit.dto';
import { CreateGalleryCategoryDto } from '../../gallery-categories/dto/gallery-category.dto';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from '../../gallery/dto/gallery.dto';
import { CreateLanguageDto, UpdateLanguageDto } from '../../languages/dto/language.dto';
import { ConfirmUploadDto, MediaQueryDto, RequestUploadUrlDto, UpdateMediaDto } from '../../media/dto/media.dto';
import { CreateCampaignDto } from '../../newsletter/dto/campaign.dto';
import { ConfirmSubscriptionDto, SubscribeDto, SubscriberQueryDto } from '../../newsletter/dto/newsletter.dto';
import { CreatePostCategoryDto } from '../../post-categories/dto/post-category.dto';
import { BulkIdsDto, CreatePostDto, PostQueryDto, UpdatePostDto } from '../../posts/dto/post.dto';
import { SearchQueryDto } from '../../search/dto/search.dto';
import { SettingKeyParamDto, UpsertSettingDto } from '../../settings/dto/setting.dto';
import { CreateSpeakerDto, SpeakerQueryDto } from '../../speakers/dto/speaker.dto';
import { CreateStaticPageDto, UpdateStaticPageDto } from '../../static-pages/dto/static-page.dto';
import { CreateStoreDto, CreateStoreLocationDto, UpdateStoreDto } from '../../stores/dto/store.dto';

type Ctor = new () => object;
type Plain = Record<string, unknown>;

// Same options as the global ValidationPipe in main.ts.
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

interface FieldError {
  path: string;
  /** class-validator constraint names that failed, e.g. `maxLength`, `arrayMaxSize`. */
  constraints: string[];
}

function flatten(errors: ValidationError[], prefix = ''): FieldError[] {
  return errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    return [...(e.constraints ? [{ path, constraints: Object.keys(e.constraints) }] : []), ...flatten(e.children ?? [], path)];
  });
}

async function fieldErrors(cls: Ctor, plain: unknown): Promise<FieldError[]> {
  return flatten(await validate(plainToInstance(cls, plain) as object, PIPE_OPTIONS));
}

async function errorPaths(cls: Ctor, plain: unknown): Promise<string[]> {
  return (await fieldErrors(cls, plain)).map((e) => e.path);
}

/** Deep copy of `base` with the value at a dotted path replaced (array indexes are plain path segments). */
function withValue(base: Plain, path: string, value: unknown): Plain {
  const clone = JSON.parse(JSON.stringify(base)) as Plain;
  const keys = path.split('.');
  let cursor = clone as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  cursor[keys[keys.length - 1]] = value;
  return clone;
}

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const str = (n: number) => 'a'.repeat(n);
const strings = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);
const uuids = (n: number) => Array.from({ length: n }, (_, i) => UUID(i + 1));
const repeat = (item: unknown) => (n: number) => Array.from({ length: n }, () => JSON.parse(JSON.stringify(item)) as unknown);

interface LimitCase {
  dto: Ctor;
  base: Plain;
  /** Dotted path to the bounded field, e.g. `translations.0.title`. */
  path: string;
  /** Display name when the same path is bounded twice (item count vs. length of each entry). */
  label?: string;
  max: number;
  /** Builds a value of "size" n; defaults to an n-character string. */
  make?: (n: number) => unknown;
  /** For fields whose format rules make an exactly-max value impossible to build (e-mail addresses). */
  overOnly?: boolean;
}

const c = (dto: Ctor, base: Plain, path: string, max: number, extra: Partial<LimitCase> = {}): LimitCase => ({
  dto,
  base,
  path,
  max,
  ...extra,
});

// ── Valid base payloads ─────────────────────────────────────────────────────

const postTr = { lang: 'ar', title: 'T', body: '<p>b</p>', is_default: true };
const createPost = { category_id: UUID(1), slug: 'a-post', translations: [postTr] };
const updatePost = { translations: [postTr] };

const bookTr = { lang: 'ar', title: 'T', is_default: true };
const createBook = { category_id: UUID(1), cover_image_id: UUID(2), translations: [bookTr] };
const updateBook = { translations: [bookTr] };

const paperTr = { lang: 'ar', title: 'T', is_default: true };
const createPaper = { category_id: UUID(1), translations: [paperTr] };
const updatePaper = { translations: [paperTr] };

const galleryTr = { lang: 'ar', title: 'T' };
const createGallery = { media_id: UUID(1), translations: [galleryTr] };
const updateGallery = { translations: [galleryTr] };

const audioTr = { lang: 'ar', title: 'T', is_default: true };
const createAudio = { audio_url: 'https://cdn.imamzain.org/a.mp3', translations: [audioTr] };
const updateAudio = { translations: [audioTr] };

const pageTr = { lang: 'ar', title: 'T', body: '<p>b</p>' };
const createPage = { slug: 'a-page', translations: [pageTr] };
const updatePage = { translations: [pageTr] };

const categoryTr = { lang: 'ar', title: 'T', slug: 'a-category' };
const createCategory = { translations: [categoryTr] };

const storeTr = { lang: 'ar', city_name: 'C' };
const locationTr = { lang: 'ar', name: 'N', address: 'A' };
const createStore = { translations: [storeTr] };
const createLocation = { translations: [locationTr] };

const hadithTr = { lang: 'ar', content: 'C' };
const speakerTr = { lang: 'ar', name: 'N', is_default: true };

const confirmUpload = { key: 'media/k.jpg', filename: 'k.jpg', mime_type: 'image/jpeg', file_size: 1 };
const submitContest = { attempt_id: UUID(1), answers: [{ question_id: '1', answer: 'A' }] };
const createContact = { name: 'Ahmad', email: 'a@example.com', message: '1234567890' };

const LIMIT_CASES: LimitCase[] = [
  // ── posts ──────────────────────────────────────────────────────────────
  c(CreatePostDto, createPost, 'translations.0.title', 500),
  c(CreatePostDto, createPost, 'translations.0.summary', 5000),
  c(CreatePostDto, createPost, 'slug', 200),
  c(CreatePostDto, createPost, 'translations', 50, { make: repeat(postTr) }),
  c(CreatePostDto, createPost, 'attachment_ids', 200, { make: uuids }),
  c(UpdatePostDto, updatePost, 'translations.0.title', 500),
  c(UpdatePostDto, updatePost, 'slug', 200),
  c(UpdatePostDto, updatePost, 'translations', 50, { make: repeat(postTr) }),
  c(UpdatePostDto, updatePost, 'attachment_ids', 200, { make: uuids }),
  c(BulkIdsDto, { ids: [UUID(1)] }, 'ids', 200, { make: uuids }),

  // ── books ──────────────────────────────────────────────────────────────
  c(CreateBookDto, createBook, 'translations.0.title', 500),
  c(CreateBookDto, createBook, 'translations.0.author', 300),
  c(CreateBookDto, createBook, 'translations.0.publisher', 300),
  c(CreateBookDto, createBook, 'translations.0.description', 5000),
  c(CreateBookDto, createBook, 'translations.0.series', 500),
  c(CreateBookDto, createBook, 'isbn', 64),
  c(CreateBookDto, createBook, 'publish_year', 64),
  c(CreateBookDto, createBook, 'document_languages', 50, { make: (n) => Array.from({ length: n }, () => 'ar') }),
  c(CreateBookDto, createBook, 'translations', 50, { make: repeat(bookTr) }),
  c(UpdateBookDto, updateBook, 'translations.0.author', 300),
  c(UpdateBookDto, updateBook, 'isbn', 64),
  c(UpdateBookDto, updateBook, 'publish_year', 64),
  c(UpdateBookDto, updateBook, 'document_languages', 50, { make: (n) => Array.from({ length: n }, () => 'ar') }),
  c(UpdateBookDto, updateBook, 'translations', 50, { make: repeat(bookTr) }),

  // ── academic papers ────────────────────────────────────────────────────
  c(CreateAcademicPaperDto, createPaper, 'translations.0.title', 500),
  c(CreateAcademicPaperDto, createPaper, 'translations.0.abstract', 5000),
  c(CreateAcademicPaperDto, createPaper, 'translations.0.publication_venue', 500),
  c(CreateAcademicPaperDto, createPaper, 'translations.0.authors', 50, { make: strings }),
  c(CreateAcademicPaperDto, createPaper, 'translations.0.authors', 300, { label: 'authors[] entry', make: (n) => [str(n)] }),
  c(CreateAcademicPaperDto, createPaper, 'translations.0.keywords', 50, { make: strings }),
  c(CreateAcademicPaperDto, createPaper, 'translations.0.keywords', 200, { label: 'keywords[] entry', make: (n) => [str(n)] }),
  c(CreateAcademicPaperDto, createPaper, 'published_year', 64),
  c(CreateAcademicPaperDto, createPaper, 'pdf_url', 2048, { make: (n) => `https://example.com/${str(n - 20)}` }),
  c(CreateAcademicPaperDto, createPaper, 'document_languages', 50, { make: (n) => Array.from({ length: n }, () => 'ar') }),
  c(CreateAcademicPaperDto, createPaper, 'translations', 50, { make: repeat(paperTr) }),
  c(UpdateAcademicPaperDto, updatePaper, 'published_year', 64),
  c(UpdateAcademicPaperDto, updatePaper, 'pdf_url', 2048, { make: (n) => `https://example.com/${str(n - 20)}` }),
  c(UpdateAcademicPaperDto, updatePaper, 'translations', 50, { make: repeat(paperTr) }),

  // ── gallery ────────────────────────────────────────────────────────────
  c(CreateGalleryImageDto, createGallery, 'translations.0.title', 500),
  c(CreateGalleryImageDto, createGallery, 'translations.0.description', 5000),
  c(CreateGalleryImageDto, createGallery, 'author', 300),
  c(CreateGalleryImageDto, createGallery, 'tags', 50, { make: strings }),
  c(CreateGalleryImageDto, createGallery, 'locations', 50, { make: strings }),
  c(CreateGalleryImageDto, createGallery, 'tags', 200, { label: 'tags[] entry', make: (n) => [str(n)] }),
  c(CreateGalleryImageDto, createGallery, 'locations', 200, { label: 'locations[] entry', make: (n) => [str(n)] }),
  c(CreateGalleryImageDto, createGallery, 'translations', 50, { make: repeat(galleryTr) }),
  c(UpdateGalleryImageDto, updateGallery, 'author', 300),
  c(UpdateGalleryImageDto, updateGallery, 'tags', 50, { make: strings }),
  c(UpdateGalleryImageDto, updateGallery, 'locations', 50, { make: strings }),
  c(UpdateGalleryImageDto, updateGallery, 'translations', 50, { make: repeat(galleryTr) }),
  c(GalleryQueryDto, {}, 'tags', 50, { make: strings }),
  c(GalleryQueryDto, {}, 'locations', 50, { make: strings }),
  c(GalleryQueryDto, {}, 'tags', 200, { label: 'tags[] entry', make: (n) => [str(n)] }),

  // ── audios ─────────────────────────────────────────────────────────────
  c(CreateAudioDto, createAudio, 'translations.0.title', 500),
  c(CreateAudioDto, createAudio, 'translations', 50, { make: repeat(audioTr) }),
  c(UpdateAudioDto, updateAudio, 'translations', 50, { make: repeat(audioTr) }),

  // ── static pages ───────────────────────────────────────────────────────
  c(CreateStaticPageDto, createPage, 'translations.0.title', 300),
  c(CreateStaticPageDto, createPage, 'translations', 50, { make: repeat(pageTr) }),
  c(UpdateStaticPageDto, updatePage, 'translations', 50, { make: repeat(pageTr) }),

  // ── categories (post / book / gallery / academic paper) ───────────────
  ...[CreatePostCategoryDto, CreateBookCategoryDto, CreateGalleryCategoryDto, CreateAcademicPaperCategoryDto].flatMap((dto) => [
    c(dto, createCategory, 'translations.0.title', 500),
    c(dto, createCategory, 'translations.0.slug', 200),
    c(dto, createCategory, 'translations.0.description', 5000),
    c(dto, createCategory, 'translations', 50, { make: repeat(categoryTr) }),
  ]),

  // ── stores ─────────────────────────────────────────────────────────────
  c(CreateStoreDto, createStore, 'translations.0.city_name', 200),
  c(CreateStoreDto, createStore, 'translations', 50, { make: repeat(storeTr) }),
  c(CreateStoreDto, createStore, 'locations', 200, { make: repeat(createLocation) }),
  c(UpdateStoreDto, createStore, 'translations', 50, { make: repeat(storeTr) }),
  c(CreateStoreLocationDto, createLocation, 'translations.0.name', 300),
  c(CreateStoreLocationDto, createLocation, 'translations.0.address', 500),
  c(CreateStoreLocationDto, createLocation, 'translations', 50, { make: repeat(locationTr) }),

  // ── daily hadiths / speakers / languages ──────────────────────────────
  c(CreateDailyHadithDto, { translations: [hadithTr] }, 'translations.0.content', 4000),
  c(CreateDailyHadithDto, { translations: [hadithTr] }, 'translations', 50, { make: repeat(hadithTr) }),
  c(UpdateDailyHadithDto, {}, 'translations', 50, { make: repeat(hadithTr) }),
  c(CreateSpeakerDto, { translations: [speakerTr] }, 'translations.0.name', 300),
  c(CreateSpeakerDto, { translations: [speakerTr] }, 'translations', 50, { make: repeat(speakerTr) }),
  c(CreateLanguageDto, { code: 'ar', name: 'Arabic', native_name: 'x' }, 'name', 100),
  c(CreateLanguageDto, { code: 'ar', name: 'Arabic', native_name: 'x' }, 'native_name', 100),
  c(UpdateLanguageDto, {}, 'name', 100),
  c(UpdateLanguageDto, {}, 'native_name', 100),

  // ── media ──────────────────────────────────────────────────────────────
  c(RequestUploadUrlDto, { filename: 'a.jpg', mime_type: 'image/png' }, 'filename', 255),
  c(RequestUploadUrlDto, { filename: 'a.jpg', mime_type: 'image/png' }, 'mime_type', 127, { make: (n) => `image/${str(n - 6)}` }),
  c(ConfirmUploadDto, confirmUpload, 'key', 1024),
  c(ConfirmUploadDto, confirmUpload, 'filename', 255),
  c(ConfirmUploadDto, confirmUpload, 'alt_text', 500),
  c(ConfirmUploadDto, confirmUpload, 'mime_type', 127, { make: (n) => `image/${str(n - 6)}` }),
  c(UpdateMediaDto, {}, 'filename', 255),
  c(UpdateMediaDto, {}, 'alt_text', 500),
  c(MediaQueryDto, {}, 'mime_type', 127, { make: (n) => `a/${str(n - 2)}` }),

  // ── settings ───────────────────────────────────────────────────────────
  c(SettingKeyParamDto, { key: 'site_name' }, 'key', 100),
  c(UpsertSettingDto, { value: 'v' }, 'value', 10_000),
  c(UpsertSettingDto, { value: 'v' }, 'description', 500),

  // ── Tier 1 DTOs: verified, kept as a regression guard ─────────────────
  c(StartContestDto, { name: 'n', contact: '+9647801234567', contactType: 'phone' }, 'name', 150),
  c(StartContestDto, { name: 'n', contact: '+9647801234567', contactType: 'phone' }, 'contact', 200),
  c(SubmitAnswerDto, { question_id: '1', answer: 'A' }, 'question_id', 64),
  c(SubmitContestDto, submitContest, 'attempt_token', 128),
  c(SubmitContestDto, submitContest, 'answers', 500, { make: repeat({ question_id: '1', answer: 'A' }) }),
  c(SubscribeDto, { email: 'a@example.com' }, 'email', 254, { overOnly: true, make: (n) => `${str(n - 6)}@ex.co` }),
  c(ConfirmSubscriptionDto, { email: 'a@example.com', token: 't' }, 'token', 256),
  c(CreateCampaignDto, { subject: 's', body_html: '<p>x</p>' }, 'subject', 200),
  c(CreateContactDto, createContact, 'name', 100),
  c(CreateContactDto, createContact, 'message', 2000),
  c(CreateContactDto, createContact, 'email', 254, { overOnly: true, make: (n) => `${str(n - 6)}@ex.co` }),
  c(UpdateContactDto, {}, 'notes', 2000),
  c(CreateProxyVisitDto, { visitor_name: 'Ali', visitor_phone: '+9647801234567', visitor_country: 'IQ' }, 'visitor_name', 100),
  c(UpdateProxyVisitDto, {}, 'notes', 2000),
];

describe('request DTO length and size limits', () => {
  const rows = LIMIT_CASES.map((lc) => [`${lc.dto.name}.${lc.label ?? lc.path}`, lc] as const);

  it('names every case uniquely', () => {
    expect(new Set(rows.map(([name]) => name)).size).toBe(rows.length);
  });

  it.each(rows.filter(([, lc]) => !lc.overOnly))('%s accepts a value of exactly the limit', async (_name, lc) => {
    const make = lc.make ?? str;
    expect(await errorPaths(lc.dto, withValue(lc.base, lc.path, make(lc.max)))).toEqual([]);
  });

  it.each(rows)('%s rejects a value one over the limit', async (_name, lc) => {
    const make = lc.make ?? str;
    const errors = await fieldErrors(lc.dto, withValue(lc.base, lc.path, make(lc.max + 1)));
    // The size rule itself must be what fires, not some incidental format rule.
    expect(errors.some((e) => e.path === lc.path && e.constraints.some((k) => k === 'maxLength' || k === 'arrayMaxSize'))).toBe(true);
  });

  it('a 95 KB title is a clean validation error, not something Prisma has to reject', async () => {
    const paths = await errorPaths(CreatePostDto, withValue(createPost, 'translations.0.title', str(95 * 1024)));
    expect(paths).toContain('translations.0.title');
  });
});

describe('search terms (list ?search= and GET /search ?q=)', () => {
  const SEARCH_DTOS: Array<[string, Ctor]> = [
    ['PostQueryDto', PostQueryDto],
    ['BookQueryDto', BookQueryDto],
    ['AudioQueryDto', AudioQueryDto],
    ['AudioAdminQueryDto', AudioAdminQueryDto],
    ['AcademicPaperQueryDto', AcademicPaperQueryDto],
    ['SpeakerQueryDto', SpeakerQueryDto],
    ['MediaQueryDto', MediaQueryDto],
    ['SubscriberQueryDto', SubscriberQueryDto],
  ];

  const parsed = (cls: Ctor, search: unknown) => plainToInstance(cls, { search }) as { search?: unknown };

  describe.each(SEARCH_DTOS)('%s.search', (_name, cls) => {
    it.each([
      ['one character', 'a'],
      ['one character with surrounding blanks', '  a  '],
      ['201 characters', str(201)],
      ['an array (repeated ?search=)', ['ab', 'cd']],
      ['a number', 12],
    ])('rejects %s', async (_label, value) => {
      expect(await errorPaths(cls, { search: value })).toContain('search');
    });

    it.each([
      ['two characters', 'ab'],
      ['two Arabic letters', 'ال'],
      ['200 characters', str(200)],
    ])('accepts %s', async (_label, value) => {
      expect(await errorPaths(cls, { search: value })).toEqual([]);
    });

    it('trims before validating and before handing the value to the service', async () => {
      expect(await errorPaths(cls, { search: '  ab  ' })).toEqual([]);
      expect(parsed(cls, '  ab  ').search).toBe('ab');
    });

    it.each([['an empty string', ''], ['blanks only', '   ']])('treats %s as no search at all', async (_label, value) => {
      expect(await errorPaths(cls, { search: value })).toEqual([]);
      expect(parsed(cls, value).search).toBeUndefined();
    });

    it('does not require the parameter', async () => {
      expect(await errorPaths(cls, {})).toEqual([]);
    });
  });

  describe('SearchQueryDto.q (required)', () => {
    it.each([
      ['one character', 'a'],
      ['one character with blanks', ' a '],
      ['blanks only', '   '],
      ['an empty string', ''],
      ['201 characters', str(201)],
    ])('rejects %s', async (_label, value) => {
      expect(await errorPaths(SearchQueryDto, { q: value })).toContain('q');
    });

    it('rejects a missing q', async () => {
      expect(await errorPaths(SearchQueryDto, {})).toContain('q');
    });

    it('trims a valid term', async () => {
      const dto = plainToInstance(SearchQueryDto, { q: '  ab  ' });
      expect(await errorPaths(SearchQueryDto, { q: '  ab  ' })).toEqual([]);
      expect(dto.q).toBe('ab');
    });
  });
});

describe('duplicate id arrays are a 400, not a primary-key collision', () => {
  const DUPLICATE_CASES: Array<[string, Ctor, Plain, string]> = [
    ['CreatePostDto.attachment_ids', CreatePostDto, createPost, 'attachment_ids'],
    ['UpdatePostDto.attachment_ids', UpdatePostDto, updatePost, 'attachment_ids'],
    ['BulkIdsDto.ids', BulkIdsDto, { ids: [UUID(1)] }, 'ids'],
  ];

  describe.each(DUPLICATE_CASES)('%s', (_name, dto, base, path) => {
    it('rejects the same id twice', async () => {
      expect(await errorPaths(dto, withValue(base, path, [UUID(1), UUID(2), UUID(1)]))).toContain(path);
    });

    it('rejects ids that differ only by letter case (Postgres compares uuids case-insensitively)', async () => {
      const lower = 'abcdefab-0000-4000-8000-000000000001';
      expect(await errorPaths(dto, withValue(base, path, [lower, lower.toUpperCase()]))).toContain(path);
    });

    it('accepts distinct ids', async () => {
      expect(await errorPaths(dto, withValue(base, path, [UUID(1), UUID(2), UUID(3)]))).toEqual([]);
    });
  });
});

describe('SettingKeyParamDto', () => {
  it('rejects an empty key', async () => {
    expect(await errorPaths(SettingKeyParamDto, { key: '' })).toContain('key');
  });
});
