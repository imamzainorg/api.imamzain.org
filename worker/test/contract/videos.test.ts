import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, tokenWith, withDb } from './support/http';
import { uid } from './support/content';

const BASE = '/api/v1/videos';
const PREFIX = uid('vidc');

// Year 3000 sorts these first in any list, whatever else the DB holds.
const at = (n: number) => `3000-01-0${n}T00:00:00Z`;
const id = (name: string) => `${PREFIX}-${name}`;
const slugsOf = (items: { slug: string }[]) => items.map((i) => i.slug);
const mine = (path: string) => `${path}${path.includes('?') ? '&' : '?'}search=${PREFIX}&limit=100`;

// name, kind, status, published day, featured
const VIDEOS: [string, 'video' | 'short' | 'live', 'published' | 'pending' | 'hidden', number, boolean][] = [
  ['ep1', 'video', 'published', 2, false],
  ['ep2', 'video', 'published', 3, false],
  ['clip', 'short', 'published', 4, false],
  ['relay', 'live', 'published', 5, false],
  ['hidden', 'video', 'hidden', 6, false],
  ['pending', 'video', 'pending', 7, false],
  ['feat', 'video', 'published', 1, true],
];
// The website's six old slugs with `(`, `)` and `.` must keep resolving.
const LEGACY_SLUG = `${PREFIX}-dua-(alyh-alslam)-.-part-1`;

const SERIES = id('series');
const HIDDEN_SERIES = id('hidden-series');
const RELAYS = id('relays');

beforeAll(async () => {
  await withDb(async (q) => {
    const internal: Record<string, string> = {};
    for (const [name, kind, status, day, featured] of VIDEOS) {
      const [v] = await q(
        `INSERT INTO youtube_videos (video_id, title, channel_id, published_at, kind) VALUES ($1, $2, 'UC-seed', $3, $4) RETURNING id::text AS id`,
        [id(name), `${PREFIX} ${name}`, at(day), kind],
      );
      internal[name] = v.id;
      await q(
        `INSERT INTO video_entries (youtube_video_id, slug, status, is_featured) VALUES ($1, $2, $3, $4)`,
        [id(name), name === 'ep1' ? LEGACY_SLUG : id(name), status, featured],
      );
    }
    const playlist = async (slug: string, hidden: boolean, items: [string, number][]) => {
      const [p] = await q(
        `INSERT INTO youtube_playlists (playlist_id, title, channel_id, published_at) VALUES ($1, $2, 'UC-seed', $3) RETURNING id::text AS id`,
        [slug, `${PREFIX} ${slug}`, at(1)],
      );
      await q(`INSERT INTO video_series (youtube_playlist_id, slug, section, is_hidden) VALUES ($1, $1, 'programmes', $2)`, [slug, hidden]);
      for (const [name, position] of items)
        await q(`INSERT INTO youtube_playlist_items (playlist_id, video_id, position) VALUES ($1, $2, $3)`, [p.id, internal[name], position]);
    };
    // Positions run against the publish order, so playlist order is observable.
    await playlist(SERIES, false, [['ep2', 0], ['ep1', 1], ['hidden', 2]]);
    await playlist(HIDDEN_SERIES, true, [['clip', 0]]);
    await playlist(RELAYS, false, [['relay', 0]]);
  });
});

afterAll(async () => {
  await withDb(async (q) => {
    await q(`DELETE FROM youtube_playlists WHERE playlist_id LIKE $1`, [`${PREFIX}%`]);
    await q(`DELETE FROM youtube_videos WHERE video_id LIKE $1`, [`${PREFIX}%`]);
    await q(`DELETE FROM video_entries WHERE youtube_video_id LIKE $1`, [`${PREFIX}%`]);
    await q(`DELETE FROM video_series WHERE youtube_playlist_id LIKE $1`, [`${PREFIX}%`]);
  });
});

describe('GET /videos', () => {
  it('serves published videos and shorts newest first, never live, hidden or waiting ones', async () => {
    const res = await api(mine(BASE));

    expectSuccess(res);
    expect(slugsOf(res.body.data.items)).toEqual([id('clip'), id('ep2'), LEGACY_SLUG, id('feat')]);
    // Only visible series are listed on a video.
    const clip = res.body.data.items[0];
    expect(clip).toMatchObject({ kind: 'short', series: [] });
    expect(res.body.data.items[1].series).toEqual([{ slug: SERIES, title: `${PREFIX} ${SERIES}` }]);
    expect(clip).not.toHaveProperty('status');
  });

  it('filters by kind and series, and lists featured videos', async () => {
    const shorts = await api(mine(`${BASE}?kind=short`));
    const series = await api(mine(`${BASE}?series=${SERIES}`));
    const featured = await api(mine(`${BASE}?featured=true`));

    expect(slugsOf(shorts.body.data.items)).toEqual([id('clip')]);
    expect(slugsOf(series.body.data.items)).toEqual([id('ep2'), LEGACY_SLUG]);
    expect(slugsOf(featured.body.data.items)).toEqual([id('feat')]);
  });

  it('rejects ?kind=live with 400', async () => {
    const res = await api(`${BASE}?kind=live`);

    expectError(res, 400, 'VALIDATION_FAILED');
  });
});

describe('GET /videos/:slug', () => {
  it('resolves an old website slug with parentheses and dots', async () => {
    const res = await api(`${BASE}/${encodeURIComponent(LEGACY_SLUG)}`);

    expectSuccess(res);
    expect(res.body.data).toMatchObject({ video_id: id('ep1'), kind: 'video' });
  });

  it.each(['relay', 'hidden', 'pending'])('answers 404 for a %s video', async (name) => {
    const res = await api(`${BASE}/${id(name)}`);

    expectError(res, 404, 'NOT_FOUND', 'Video not found');
  });
});

describe('GET /videos/series', () => {
  it('lists visible series with served videos only: no hidden series, no all-live relay playlist', async () => {
    const res = await api(`${BASE}/series`);

    expectSuccess(res);
    const mineOnly = res.body.data.filter((s: { slug: string }) => s.slug.startsWith(PREFIX));
    expect(mineOnly).toEqual([
      expect.objectContaining({ slug: SERIES, section: 'programmes', video_count: 2 }),
    ]);
  });

  it('returns a series with its served videos in YouTube playlist order', async () => {
    const res = await api(`${BASE}/series/${SERIES}`);

    expectSuccess(res);
    expect(slugsOf(res.body.data.videos)).toEqual([id('ep2'), LEGACY_SLUG]);
  });

  it.each([HIDDEN_SERIES, RELAYS])('answers 404 for %s', async (slug) => {
    const res = await api(`${BASE}/series/${slug}`);

    expectError(res, 404, 'NOT_FOUND', 'Series not found');
  });
});

describe('GET /homepage videos', () => {
  it('puts featured videos first, then the newest long-form ones, one per series, never shorts', async () => {
    const res = await api('/api/v1/homepage');

    const urls = res.body.data.videos.map((v: { url: string }) => v.url).filter((u: string) => u.startsWith(PREFIX));
    expect(urls).toEqual([id('feat'), id('ep2')]);
  });
});

describe('CMS /videos/admin', () => {
  it('needs a token, and videos:update to write', async () => {
    const reader = await tokenWith(['videos:read']);

    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(
      await api(`${BASE}/admin/${id('ep2')}`, { method: 'PATCH', token: reader, body: { status: 'hidden' } }),
      403,
      'FORBIDDEN',
    );
  });

  it('lists every non-live video with its status', async () => {
    const res = await api(mine(`${BASE}/admin`), { token: await adminToken() });

    expectSuccess(res);
    const byStatus = Object.fromEntries(res.body.data.items.map((i: { slug: string; status: string }) => [i.slug, i.status]));
    expect(byStatus).toEqual({
      [id('pending')]: 'pending',
      [id('hidden')]: 'hidden',
      [id('clip')]: 'published',
      [id('ep2')]: 'published',
      [LEGACY_SLUG]: 'published',
      [id('feat')]: 'published',
    });
  });

  it('publishes a waiting video, and hides it again', async () => {
    const token = await adminToken();
    const publish = await api(`${BASE}/admin/${id('pending')}`, { method: 'PATCH', token, body: { status: 'published' } });
    const visible = await api(`${BASE}/${id('pending')}`);
    await api(`${BASE}/admin/${id('pending')}`, { method: 'PATCH', token, body: { status: 'hidden' } });
    const gone = await api(`${BASE}/${id('pending')}`);

    expectSuccess(publish);
    expect(publish.body.data).toMatchObject({ slug: id('pending'), status: 'published' });
    expect(visible.status).toBe(200);
    expect(gone.status).toBe(404);
  });

  it('refuses to rename a published video (its URL is public) and to reuse another video\'s slug', async () => {
    const token = await adminToken();
    const locked = await api(`${BASE}/admin/${id('ep2')}`, { method: 'PATCH', token, body: { slug: id('renamed') } });
    const taken = await api(`${BASE}/admin/${id('hidden')}`, { method: 'PATCH', token, body: { slug: id('ep2') } });

    expectError(locked, 409, 'SLUG_LOCKED_WHILE_PUBLISHED');
    expectError(taken, 409, 'CONFLICT', `Slug "${id('ep2')}" is already used by another video`);
  });

  it('hides a series from the public lists', async () => {
    const token = await adminToken();
    const res = await api(`${BASE}/admin/series/${SERIES}`, { method: 'PATCH', token, body: { is_hidden: true } });
    const detail = await api(`${BASE}/series/${SERIES}`);
    await api(`${BASE}/admin/series/${SERIES}`, { method: 'PATCH', token, body: { is_hidden: false } });

    expectSuccess(res);
    expect(res.body.data).toMatchObject({ slug: SERIES, is_hidden: true });
    expect(detail.status).toBe(404);
  });

  it('switches auto-publishing of new uploads', async () => {
    const token = await adminToken();
    const before = await api(`${BASE}/admin/settings`, { token });
    const off = await api(`${BASE}/admin/settings`, { method: 'PUT', token, body: { auto_publish: false } });
    const read = await api(`${BASE}/admin/settings`, { token });
    await api(`${BASE}/admin/settings`, { method: 'PUT', token, body: { auto_publish: before.body.data.auto_publish } });

    expectSuccess(off);
    expect(read.body.data).toEqual({ auto_publish: false });
  });
});
