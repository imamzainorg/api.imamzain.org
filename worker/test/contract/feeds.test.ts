import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, randomIp, expectSuccess, withDb, workerOnly } from './support/http';
import { dropLanguage, dropPosts, retiredLanguage, seedPost, uid } from './support/content';

const BASE = '/api/v1';
const SITE = 'https://imamzain.org';
const PREFIX = uid('fd');
const RETIRED = 'zx';
const VIDEO_ID = `${PREFIX}-vid`;

const live = `${PREFIX}-live`;
const noSummary = `${PREFIX}-plain`;
const draft = `${PREFIX}-draft`;
const gone = `${PREFIX}-gone`;
const ampersand = `${PREFIX}-a&b`;
const onlyRetired = `${PREFIX}-retired`;

beforeAll(async () => {
  await retiredLanguage(RETIRED);
  // Far-future dates and is_featured: these sort ahead of whatever the DB holds in every "latest" list.
  await seedPost({
    slug: live,
    is_featured: true,
    published_at: '2999-06-03T00:00:00Z',
    translations: [
      { lang: 'ar', title: `${PREFIX} عنوان`, summary: 'ملخص <الخبر>' },
      { lang: 'en', title: `${PREFIX} title`, is_default: false },
    ],
  });
  await seedPost({ slug: noSummary, published_at: '2999-06-02T00:00:00Z', translations: [{ lang: 'ar', title: `${PREFIX} plain`, body: '<p>Hello <b>world</b></p>' }] });
  await seedPost({ slug: `${PREFIX}-fill`, published_at: '2999-05-30T00:00:00Z', translations: [{ lang: 'ar', title: `${PREFIX} fill` }] });
  await seedPost({ slug: draft, is_published: false, translations: [{ lang: 'ar', title: `${PREFIX} draft` }] });
  await seedPost({ slug: gone, deleted: true, translations: [{ lang: 'ar', title: `${PREFIX} gone` }] });
  await seedPost({ slug: ampersand, published_at: '2999-06-01T00:00:00Z', translations: [{ lang: 'ar', title: `${PREFIX} amp` }] });
  await withDb((q) =>
    q(`INSERT INTO youtube_videos (video_id, title, channel_id, published_at, description) VALUES ($1, $2, 'UC-seed', '3000-01-01T00:00:00Z', $3)`, [
      VIDEO_ID,
      `${PREFIX} video`,
      `line one\n\n   line   two ${'x'.repeat(300)}`,
    ]),
  );
});

afterAll(async () => {
  await dropPosts(PREFIX);
  await dropLanguage(RETIRED);
  await withDb((q) => q(`DELETE FROM youtube_videos WHERE video_id = $1`, [VIDEO_ID]));
});

describe('GET /sitemap.xml', () => {
  it('lists published posts as canonical site URLs, XML-escaped, and nothing unpublished or deleted', async () => {
    const res = await api(`${BASE}/sitemap.xml`);

    expect(res.status, res.text).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=900');
    expect(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(res.text.endsWith('</urlset>')).toBe(true);
    expect(res.text).toContain(`<loc>${SITE}/news/${live}</loc>`);
    expect(res.text).toContain(`<loc>${SITE}/news/${PREFIX}-a&amp;b</loc>`);
    expect(res.text).not.toContain(draft);
    expect(res.text).not.toContain(gone);
  });

  it('carries an ETag and answers a matching If-None-Match with a body-less 304', async () => {
    const first = await api(`${BASE}/sitemap.xml`);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/"/);

    const again = await api(`${BASE}/sitemap.xml`, { headers: { 'if-none-match': etag!, 'cache-control': 'max-age=0' } });

    expect(again.status).toBe(304);
    expect(again.text).toBe('');
  });

  it('answers 429 past 20 requests a minute from one client', async () => {
    const ip = randomIp();
    const calls = await Promise.all(Array.from({ length: 22 }, () => api(`${BASE}/sitemap.xml`, { ip })));

    expect(calls.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((r) => r.status === 200).length).toBeLessThanOrEqual(20);
  });
});

describe('GET /rss/posts.xml', () => {
  it('emits the newest published posts in their default translation, with a plain-text description', async () => {
    const res = await api(`${BASE}/rss/posts.xml`);

    expect(res.status, res.text).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=900');
    expect(res.text).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(res.text).toContain(`<atom:link href="${SITE}/rss/posts.xml" rel="self" type="application/rss+xml"/>`);
    // The newest post first; the English translation never leaks into a feed.
    expect(res.text).toContain(
      `<item>\n      <title>${PREFIX} عنوان</title>\n      <link>${SITE}/news/${live}</link>\n      <guid>${SITE}/news/${live}</guid>\n      <pubDate>Mon, 03 Jun 2999 00:00:00 GMT</pubDate>\n      <description>ملخص &lt;الخبر&gt;</description>`,
    );
    expect(res.text).not.toContain(`${PREFIX} title`);
    // No summary: the body's text, tags stripped.
    expect(res.text).toContain(`<link>${SITE}/news/${noSummary}</link>`);
    expect(res.text).toContain('<description>Hello world</description>');
    expect(res.text).not.toContain(draft);
    expect(res.text).not.toContain(gone);
    expect((res.text.match(/<item>/g) ?? []).length).toBeLessThanOrEqual(50);
  });
});

describe('GET /homepage', () => {
  it('returns the composite payload, cacheable but never past site midnight', async () => {
    const res = await api(`${BASE}/homepage`, { lang: 'en' });

    expectSuccess(res);
    expect(res.body.message).toBe('Homepage fetched');
    expect(Object.keys(res.body.data)).toEqual(['hadith_of_day', 'news', 'publications', 'videos', 'gallery']);
    expect(Object.keys(res.body.data.gallery)).toEqual(['slider', 'categories']);
    expect(res.headers.get('vary')).toMatch(/Accept-Language/i);
    const [, maxAge, sMaxAge] = res.headers.get('cache-control')!.match(/^public, max-age=(\d+), s-maxage=(\d+)$/)!.map(Number);
    expect(maxAge).toBeGreaterThanOrEqual(1);
    expect(maxAge).toBeLessThanOrEqual(900);
    expect(sMaxAge).toBeLessThanOrEqual(3600);
    expect(res.body.data.news.length).toBeLessThanOrEqual(4);
    expect(res.body.data.publications.length).toBeLessThanOrEqual(10);
  });

  it('puts the featured post first, titled in the requested language', async () => {
    const en = await api(`${BASE}/homepage`, { lang: 'en' });
    const ar = await api(`${BASE}/homepage`, { lang: 'ar' });

    expect(en.body.data.news[0]).toEqual({ slug: live, image: null, image_variants: [], summary: null, title: `${PREFIX} title` });
    expect(ar.body.data.news[0]).toMatchObject({ slug: live, summary: 'ملخص <الخبر>', title: `${PREFIX} عنوان` });
  });

  it('lists the newest mirrored video with the 11-char id as `url` and a collapsed, capped description', async () => {
    const res = await api(`${BASE}/homepage`);

    const video = res.body.data.videos.find((v: { url: string }) => v.url === VIDEO_ID);
    expect(video).toEqual({
      title: `${PREFIX} video`,
      url: VIDEO_ID,
      desc: `line one line two ${'x'.repeat(300)}`.slice(0, 279) + '…',
      thumbnail: null,
      date: '3000-01-01T00:00:00.000Z',
    });
    expect(res.body.data.videos.length).toBeLessThanOrEqual(7);
  });

  workerOnly('worker-only: leaves out a post whose only translation is in a retired language, and still fills the block', async () => {
    const slug = `${PREFIX}-news-retired`;
    await seedPost({ slug, is_featured: true, published_at: '2999-07-01T00:00:00Z', translations: [{ lang: RETIRED, title: `${PREFIX} retired` }] });

    const res = await api(`${BASE}/homepage`, { lang: 'ar' });

    const news = res.body.data.news as { slug: string; title: string | null }[];
    expect(news.map((n) => n.slug)).not.toContain(slug);
    expect(news.every((n) => n.title !== null)).toBe(true);
    expect(news).toHaveLength(4);
  });
});
