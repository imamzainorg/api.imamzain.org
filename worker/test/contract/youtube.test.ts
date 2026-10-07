import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, expectError, expectSuccess, withDb } from './support/http';
import { uid } from './support/content';

const BASE = '/api/v1/youtube';
const MISSING = 'PL-does-not-exist';
const PREFIX = uid('ytc');

// 3000 is past any real video: these rows sort first in the videos list, whatever the DB holds.
const at = (n: number) => `3000-01-01T00:00:0${n}Z`;
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;

const playlistId = `${PREFIX}-pl`;
const videoIds = [0, 1, 2].map((n) => `${PREFIX}-v${n}`);

beforeAll(async () => {
  await withDb(async (q) => {
    const [pl] = await q(
      `INSERT INTO youtube_playlists (playlist_id, title, channel_id, item_count, published_at) VALUES ($1, 'Seeded playlist', 'UC-seed', 7, $2) RETURNING id::text AS id`,
      [playlistId, at(0)],
    );
    for (const [n, videoId] of videoIds.entries()) {
      const [v] = await q(
        `INSERT INTO youtube_videos (video_id, title, channel_id, published_at, view_count, like_count) VALUES ($1, $2, 'UC-seed', $3, $4, NULL) RETURNING id::text AS id`,
        [videoId, `${PREFIX} video ${n}`, at(n), 1000 + n],
      );
      // Positions run against the publish order, so ordering by position is observable.
      await q(`INSERT INTO youtube_playlist_items (playlist_id, video_id, position) VALUES ($1, $2, $3)`, [pl.id, v.id, 2 - n]);
    }
  });
});

afterAll(async () => {
  await withDb(async (q) => {
    await q(`DELETE FROM youtube_playlists WHERE playlist_id = $1`, [playlistId]);
    await q(`DELETE FROM youtube_videos WHERE video_id LIKE $1`, [`${PREFIX}%`]);
  });
});

describe('GET /youtube/videos', () => {
  it('lists newest first with numeric counts, a CDN-cacheable response and pagination', async () => {
    const res = await api(`${BASE}/videos?page=1&limit=3`);

    expectSuccess(res);
    expect(res.body.message).toBe('Videos fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=3600');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/i);
    const items = res.body.data.items;
    expect(items.map((i: { video_id: string }) => i.video_id)).toEqual([videoIds[2], videoIds[1], videoIds[0]]);
    expect(items[0]).toMatchObject({ title: `${PREFIX} video 2`, view_count: 1002, like_count: null, channel_id: 'UC-seed' });
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 3 });
    expect(res.body.data.pagination.pages).toBe(Math.ceil(res.body.data.pagination.total / 3));
  });

  it.each([
    ['?page=0', ['page must not be less than 1']],
    ['?limit=101', ['limit must not be greater than 100']],
    ['?foo=1', ['property foo should not exist']],
  ])('rejects %s with 400', async (query, errors) => {
    const res = await api(`${BASE}/videos${query}`);

    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(errors);
  });
});

describe('GET /youtube/playlists', () => {
  it('lists playlists newest first', async () => {
    const res = await api(`${BASE}/playlists?limit=1`);

    expectSuccess(res);
    expect(res.body.message).toBe('Playlists fetched');
    expect(res.body.data.items[0]).toMatchObject({ playlist_id: playlistId, title: 'Seeded playlist', item_count: 7 });
  });
});

describe('GET /youtube/playlists/:playlistId/videos', () => {
  it('returns the playlist and its videos in playlist order, with YouTube\'s own item_count as total', async () => {
    const res = await api(`${BASE}/playlists/${playlistId}/videos`);

    expectSuccess(res);
    expect(res.body.message).toBe('Playlist videos fetched');
    expect(res.body.data.playlist.playlist_id).toBe(playlistId);
    expect(res.body.data.videos.map((v: { video_id: string }) => v.video_id)).toEqual([videoIds[2], videoIds[1], videoIds[0]]);
    expect(res.body.data.total).toBe(7);
  });

  it('truncates to limit without changing total', async () => {
    const res = await api(`${BASE}/playlists/${playlistId}/videos?limit=2`);

    expectSuccess(res);
    expect(res.body.data.videos).toHaveLength(2);
    expect(res.body.data.total).toBe(7);
  });

  it('answers 404 for a playlist that is not in the mirror', async () => {
    expectError(await api(`${BASE}/playlists/${MISSING}/videos`), 404, 'NOT_FOUND', 'Playlist not found');
  });

  it('rejects a limit above 200', async () => {
    const res = await api(`${BASE}/playlists/${playlistId}/videos?limit=201`);

    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(['limit must not be greater than 200']);
  });
});
