import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { HomepageService } from './homepage.service';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';

/**
 * Cache headers of the feeds routes over real HTTP, services mocked. The
 * homepage embeds the hadith of the day, so it must stop being cacheable at
 * site midnight (Asia/Baghdad, 21:00:00 UTC) like /daily-hadiths/today does;
 * the XML feeds are not day-bound and must stay on their fixed headers.
 */

// Freeze only the wall clock: the HTTP server and fetch still need real timers.
const REAL_TIMERS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;
const freezeClock = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: [...REAL_TIMERS] });

describe('FeedsController (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  const originalTz = process.env.SITE_TIMEZONE;

  const get = (path: string) => (globalThis as any).fetch(`${base}${path}`) as Promise<Response>;

  beforeAll(async () => {
    delete process.env.SITE_TIMEZONE;

    const moduleRef = await Test.createTestingModule({
      controllers: [FeedsController],
      providers: [
        {
          provide: HomepageService,
          useValue: { getHomepage: jest.fn().mockResolvedValue({ message: 'Homepage fetched', data: { hadith_of_day: null } }) },
        },
        {
          provide: FeedsService,
          useValue: {
            buildSitemap: jest.fn().mockResolvedValue('<urlset/>'),
            buildPostsRss: jest.fn().mockResolvedValue('<rss/>'),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address();
    base = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(async () => {
    if (originalTz === undefined) delete process.env.SITE_TIMEZONE;
    else process.env.SITE_TIMEZONE = originalTz;
    await app.close();
  });

  afterEach(() => jest.useRealTimers());

  describe('GET /homepage never outlives site midnight', () => {
    const cacheControl = async (iso: string) => {
      freezeClock(iso);
      const res = await get('/homepage');
      expect(res.status).toBe(200);
      expect(res.headers.get('vary')).toContain('Accept-Language');
      return res.headers.get('cache-control');
    };

    it('keeps the configured TTLs mid-day', async () => {
      expect(await cacheControl('2026-05-12T06:00:00.000Z')).toBe('public, max-age=900, s-maxage=3600');
    });

    it('cuts the TTLs to the time left in the site day', async () => {
      expect(await cacheControl('2026-05-12T20:30:00.000Z')).toBe('public, max-age=900, s-maxage=1800');
      expect(await cacheControl('2026-05-12T20:50:00.000Z')).toBe('public, max-age=600, s-maxage=600');
    });

    it('is the full configured TTL at exactly midnight, and never below 1 second just before it', async () => {
      expect(await cacheControl('2026-05-12T21:00:00.000Z')).toBe('public, max-age=900, s-maxage=3600');
      expect(await cacheControl('2026-05-12T20:59:59.999Z')).toBe('public, max-age=1, s-maxage=1');
    });
  });

  it('leaves the sitemap and RSS feed on their fixed headers, a second before midnight', async () => {
    freezeClock('2026-05-12T20:59:59.000Z');

    const sitemap = await get('/sitemap.xml');
    const rss = await get('/rss/posts.xml');

    expect(sitemap.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=900');
    expect(rss.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=900');
  });
});
