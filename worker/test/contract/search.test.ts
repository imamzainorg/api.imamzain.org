import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, expectError, expectSuccess, randomIp } from './support/http';
import { dropLanguage, dropPosts, retiredLanguage, seedPost, uid } from './support/content';

const BASE = '/api/v1/search';
const PREFIX = uid('srch');
// Made-up words: trigram similarity 1 with themselves, none with each other (random letters, no shared prefix).
const word = () => Array.from({ length: 14 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const search = (q: string, extra = '', lang?: string) => api(`${BASE}?q=${encodeURIComponent(q)}${extra}`, { lang });
const slugsOf = (res: { body: { data: { post?: { items: { slug: string }[] } } } }) => res.body.data.post?.items.map((i) => i.slug) ?? [];

const RETIRED = 'zy';

const main = word();
const bilingual = word();
const retiredWord = word();

beforeAll(async () => {
  await retiredLanguage(RETIRED);
  await seedPost({ slug: `${PREFIX}-live`, translations: [{ lang: 'ar', title: main, summary: 'ملخص' }] });
  await seedPost({ slug: `${PREFIX}-draft`, is_published: false, translations: [{ lang: 'ar', title: main }] });
  await seedPost({ slug: `${PREFIX}-gone`, deleted: true, translations: [{ lang: 'ar', title: main }] });
  await seedPost({
    slug: `${PREFIX}-bi`,
    translations: [
      { lang: 'ar', title: 'عنوان عربي لا يشبه شيئا' },
      { lang: 'en', title: bilingual, is_default: false },
    ],
  });
  await seedPost({ slug: `${PREFIX}-retired`, translations: [{ lang: RETIRED, title: retiredWord }] });
});

afterAll(async () => {
  await dropPosts(PREFIX);
  await dropLanguage(RETIRED);
});

describe('GET /search', () => {
  it('finds a published post and shapes the hit, with one bucket per type and the term trimmed', async () => {
    const res = await search(`  ${main}  `);

    expectSuccess(res);
    expect(res.body.message).toBe('Search results');
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60');
    expect(res.body.data.q).toBe(main);
    expect(Object.keys(res.body.data)).toEqual(['q', 'post', 'book', 'academic_paper', 'gallery_image', 'audio']);
    expect(res.body.data.post.total).toBe(1);
    expect(res.body.data.post.items[0]).toEqual({
      type: 'post',
      id: expect.any(String),
      title: main,
      summary: 'ملخص',
      lang: 'ar',
      slug: `${PREFIX}-live`,
      cover_image_url: null,
      cover_image_variants: [],
    });
  });

  it('never returns drafts, soft-deleted posts or posts whose only language is retired', async () => {
    expect(slugsOf(await search(main))).toEqual([`${PREFIX}-live`]);
    expect((await search(retiredWord)).body.data.post.items).toEqual([]);
  });

  it('returns the translation that matched, even when it is not in the requested language', async () => {
    const res = await search(bilingual, '', 'ar');

    expectSuccess(res);
    expect(res.body.data.post.items[0]).toMatchObject({ slug: `${PREFIX}-bi`, title: bilingual, lang: 'en' });
  });

  it('limits the buckets to the requested types, however they are written', async () => {
    for (const types of ['types=post', 'types=post&types=audio']) {
      const res = await search(main, `&${types}`);
      expectSuccess(res);
      expect(Object.keys(res.body.data)).toEqual(['q', 'post', ...(types.includes('audio') ? ['audio'] : [])]);
    }
    expect(Object.keys((await search(main, '&types=audio,post')).body.data)).toEqual(['q', 'post', 'audio']);
  });

  it('caps hits per type at limit', async () => {
    await seedPost({ slug: `${PREFIX}-more1`, translations: [{ lang: 'ar', title: `${main} one` }] });
    await seedPost({ slug: `${PREFIX}-more2`, translations: [{ lang: 'ar', title: `${main} two` }] });

    const res = await search(main, '&types=post&limit=2');

    expectSuccess(res);
    expect(res.body.data.post.items).toHaveLength(2);
    expect(res.body.data.post.total).toBe(2);
  });

  it.each([
    ['', 'q must be longer than or equal to 2 characters'],
    ['a', 'q must be longer than or equal to 2 characters'],
    ['x'.repeat(201), 'q must be shorter than or equal to 200 characters'],
  ])('rejects the term of length %#', async (q, error) => {
    const res = await api(`${BASE}?q=${q}`);

    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual([error]);
  });

  it.each([
    ['&types=video', ['each value in types must be one of the following values: post, book, academic_paper, gallery_image, audio']],
    ['&limit=51', ['limit must not be greater than 50']],
    ['&limit=0', ['limit must not be less than 1']],
    ['&foo=1', ['property foo should not exist']],
  ])('rejects %s', async (extra, errors) => {
    const res = await search(main, extra);

    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(errors);
  });

  it('answers 429 once a client passes 60 searches a minute', async () => {
    const ip = randomIp();
    const calls = await Promise.all(Array.from({ length: 62 }, () => api(`${BASE}?q=${main}&types=audio`, { ip })));

    expect(calls.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((r) => r.status === 200).length).toBeLessThanOrEqual(60);
  });
});
