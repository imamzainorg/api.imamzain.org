import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { it as base, describe, expect, it } from 'vitest';
import { WORK_DIR, WORKER_DIR } from '../harness/config';
import { images } from '../fixtures/images';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, TARGET, tokenWith, withDb } from './support/http';
import { tokenSub, uid } from './support/rbac';

const BASE = '/api/v1/media';
const MISSING = '00000000-0000-4000-8000-000000000000';
const IN_USE_HINT = 'Detach the image from those records first; a record in the trash still holds its reference until the image is changed on the record itself.';

/**
 * Behaviour that needs a real object in the bucket. The harness Nest has no bucket (fake R2
 * credentials), while the Worker's R2 binding is wrangler's local bucket, which these tests fill
 * through `wrangler r2 object put --local`. So they run on the Worker only.
 */
const storage = TARGET === 'worker' ? base : base.skip;

const run = promisify(execFile);
const wrangler = (...args: string[]) =>
  run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', ...args, '--local', '--persist-to', path.join(WORK_DIR, 'wrangler-state')], { cwd: WORKER_DIR });

async function r2Put(key: string, bytes: Uint8Array, contentType: string) {
  const file = path.join(os.tmpdir(), `media-${uid('f')}`);
  fs.writeFileSync(file, bytes);
  try {
    await wrangler('put', `imamzain-media/${key}`, '--file', file, '--content-type', contentType);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const r2Exists = async (key: string) =>
  wrangler('get', `imamzain-media/${key}`, '--pipe').then(
    () => true,
    () => false,
  );

async function uploadUrl(filename = 'Shrine Photo.JPG', mime_type = 'image/jpeg') {
  const res = await api(`${BASE}/upload-url`, { method: 'POST', token: await adminToken(), body: { filename, mime_type } });
  expectSuccess(res, 201);
  return res.body.data as { uploadUrl: string; key: string; publicUrl: string; mediaId: string; maxBytes: number };
}

const confirm = async (key: string, extra: Record<string, unknown> = {}) =>
  api(`${BASE}/confirm`, { method: 'POST', token: await adminToken(), body: { key, filename: 'photo.jpg', mime_type: 'image/jpeg', file_size: 1000, ...extra } });

/** A media row straight in the DB (no file), `minutesAgo` old. */
async function insertMedia(opts: { mime?: string; width?: number | null; minutesAgo?: number; filename?: string } = {}) {
  return withDb(async (q) => {
    const [row] = await q(
      `INSERT INTO media (filename, url, mime_type, file_size, width, height, created_at)
       VALUES ($1, $2, $3, 1000, $4, 100, now() - make_interval(mins => $5)) RETURNING id`,
      [opts.filename ?? `${uid('m')}.jpg`, `https://cdn.imamzain.org/media/${uid('m')}.jpg`, opts.mime ?? 'image/jpeg', opts.width === undefined ? 1000 : opts.width, opts.minutesAgo ?? 10],
    );
    return row.id as string;
  });
}

describe('POST /media/upload-url', () => {
  it('presigns a PUT under the planned media id, with Content-Type signed, and records the pending upload', async () => {
    const data = await uploadUrl('Shrine Photo.JPG');

    expect(Object.keys(data)).toEqual(['uploadUrl', 'key', 'publicUrl', 'mediaId', 'maxBytes']);
    expect(data.key).toBe(`media/originals/${data.mediaId}/shrine-photo.jpg`);
    expect(data.publicUrl).toBe(`https://cdn.imamzain.org/${data.key}`);
    expect(data.maxBytes).toBe(25 * 1024 * 1024);

    const url = new URL(data.uploadUrl);
    expect(url.host).toBe('imamzain-media.harness-account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/${data.key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^harness-key\/\d{8}\/auto\/s3\/aws4_request$/);

    const [pending] = await withDb((q) => q('SELECT requested_by FROM pending_media_uploads WHERE key = $1', [data.key]));
    expect(pending.requested_by).toBe(tokenSub(await adminToken()));
  });

  it('refuses a type outside jpeg/png/gif/webp', async () => {
    const svg = await api(`${BASE}/upload-url`, { method: 'POST', token: await adminToken(), body: { filename: 'x.svg', mime_type: 'image/svg+xml' } });
    expectError(svg, 400, 'BAD_REQUEST', 'MIME type "image/svg+xml" is not allowed. Permitted types: image/jpeg, image/png, image/gif, image/webp');

    const pdf = await api(`${BASE}/upload-url`, { method: 'POST', token: await adminToken(), body: { filename: 'x.pdf', mime_type: 'application/pdf' } });
    expectError(pdf, 400, 'VALIDATION_FAILED');
    expect(pdf.body.errors).toEqual(['mime_type must match /^image\\// regular expression']);
  });

  it('is 401 / 403 without media:create', async () => {
    expectError(await api(`${BASE}/upload-url`, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED');
    expectError(
      await api(`${BASE}/upload-url`, { method: 'POST', token: await tokenWith(['media:read']), body: { filename: 'x.jpg', mime_type: 'image/jpeg' } }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('POST /media/confirm', () => {
  it('checks the key, its owner and its expiry before touching storage', async () => {
    expectError(await confirm('posts/x.jpg'), 400, 'BAD_REQUEST', 'Invalid storage key');
    expectError(await confirm(`media/originals/${MISSING}/nope.jpg`), 404, 'NOT_FOUND', 'No pending upload for that key — request a new upload URL');

    const foreign = `media/originals/${crypto.randomUUID()}/x.jpg`;
    const expired = `media/originals/${crypto.randomUUID()}/x.jpg`;
    const admin = tokenSub(await adminToken());
    await withDb(async (q) => {
      await q('INSERT INTO pending_media_uploads (key, requested_by) VALUES ($1, NULL)', [foreign]);
      await q(`INSERT INTO pending_media_uploads (key, requested_by, expires_at) VALUES ($1, $2, now() - interval '1 minute')`, [expired, admin]);
    });
    expectError(await confirm(foreign), 403, 'FORBIDDEN', 'Upload key was issued to a different user');
    expectError(await confirm(expired), 410, 'ERROR', 'Upload URL has expired — request a new one');
  });

  it('refuses a key whose file was never uploaded', async () => {
    const { key } = await uploadUrl();
    expectError(await confirm(key), 400, 'BAD_REQUEST', 'File not found in storage — upload the file before confirming');
  });

  it.each([
    ['a zero size', { file_size: 0 }, ['file_size must not be less than 1']],
    ['a fractional width', { width: 1.5 }, ['width must be an integer number']],
    ['a non-image type', { mime_type: 'text/html' }, ['mime_type must match /^image\\// regular expression']],
    ['a 1025-char key', { key: `media/${'k'.repeat(1019)}` }, ['key must be shorter than or equal to 1024 characters']],
  ])('rejects %s', async (_name, extra, errors) => {
    const res = await confirm('media/x.jpg', extra);
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(errors);
  });

  storage('storage (worker only): registers the upload under its planned id with the displayed size, then builds the variants', async () => {
    const { key, mediaId, publicUrl } = await uploadUrl('rotated.jpg');
    await r2Put(key, images.jpegRotated.bytes, 'image/jpeg');

    const res = await confirm(key, { alt_text: 'alt', width: 9999, height: 9999 });
    expectSuccess(res, 201);
    expect(res.body.message).toBe('Media created');
    // Stored 800x400 with EXIF orientation 6: displayed 400x800, not what the client claimed.
    expect(res.body.data).toMatchObject({ id: mediaId, url: publicUrl, mime_type: 'image/jpeg', width: 400, height: 800, variants: [], planned_widths: [320], variants_status: 'processing' });
    expect(await withDb((q) => q('SELECT 1 FROM pending_media_uploads WHERE key = $1', [key]))).toHaveLength(0);

    let item;
    for (let i = 0; i < 40; i++) {
      item = (await api(`${BASE}/${mediaId}`, { token: await adminToken() })).body.data;
      if (item.variants_status !== 'processing') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(item).toMatchObject({ variants_status: 'ready', planned_widths: [320] });
    expect(item.variants).toEqual([expect.objectContaining({ width: 320, format: 'webp', url: `https://cdn.imamzain.org/media/variants/${mediaId}/w320.webp` })]);
    expect(await r2Exists(`media/variants/${mediaId}/w320.webp`)).toBe(true);
  });

  storage('storage (worker only): refuses and removes an object that is not an image, or not an allowed type', async () => {
    const html = await uploadUrl('page.png', 'image/png');
    await r2Put(html.key, new TextEncoder().encode('<!doctype html><script>alert(1)</script>'), 'image/png');
    expectError(await confirm(html.key, { mime_type: 'image/png' }), 400, 'BAD_REQUEST', 'Uploaded file is not a JPEG, PNG, GIF or WebP image');
    expect(await r2Exists(html.key)).toBe(false);

    const typed = await uploadUrl();
    await r2Put(typed.key, images.jpegPlain.bytes, 'text/html');
    expectError(await confirm(typed.key), 400, 'BAD_REQUEST', 'Stored object type "text/html" is not an allowed image type');
    expect(await r2Exists(typed.key)).toBe(false);
  });

  // REHAUL-FINDINGS-2026-09 (media.service.ts:163, :162).
  storage('worker-only: refuses a file whose bytes are another type than its label, and an empty file', async () => {
    const mislabelled = await uploadUrl();
    await r2Put(mislabelled.key, images.pngWide.bytes, 'image/jpeg');
    expectError(await confirm(mislabelled.key), 400, 'BAD_REQUEST', 'Stored object type "image/jpeg" does not match the file, which is image/png');
    expect(await r2Exists(mislabelled.key)).toBe(false);

    const empty = await uploadUrl();
    await r2Put(empty.key, new Uint8Array(), 'image/jpeg');
    expectError(await confirm(empty.key), 400, 'BAD_REQUEST', 'Uploaded file is not a JPEG, PNG, GIF or WebP image');
  });
});

describe('GET /media and /media/:id', () => {
  it('derives each row’s variant plan and status', async () => {
    const wide = await insertMedia({ width: 1000 });
    const tiny = await insertMedia({ width: 100 });
    const gif = await insertMedia({ mime: 'image/gif', width: 500 });
    const fresh = await insertMedia({ width: 1000, minutesAgo: 0 });
    const ready = await insertMedia({ width: 500 });
    await withDb((q) => q(`INSERT INTO media_variants (media_id, width, url, file_size) VALUES ($1, 320, 'https://cdn.imamzain.org/v.webp', 10)`, [ready]));
    const get = async (id: string) => (await api(`${BASE}/${id}`, { token: await adminToken() })).body.data;

    expect(await get(wide)).toMatchObject({ planned_widths: [320, 768], variants_status: 'partial', variants_status_reason: 'GENERATION_INCOMPLETE', variants: [] });
    expect(await get(tiny)).toMatchObject({ planned_widths: [], variants_status: 'unavailable', variants_status_reason: 'TOO_SMALL' });
    expect(await get(gif)).toMatchObject({ planned_widths: [], variants_status: 'not_applicable', variants_status_reason: 'ANIMATED' });
    expect(await get(fresh)).toMatchObject({ variants_status: 'processing' });
    const r = await get(ready);
    expect(r).toMatchObject({ planned_widths: [320], variants_status: 'ready' });
    expect(r.variants).toEqual([expect.objectContaining({ media_id: ready, width: 320, file_size: 10, format: 'webp' })]);
    expect(r.variants_status_reason).toBeUndefined();
  });

  it('searches filename and alt text, filters by type, newest first', async () => {
    const stem = uid('find');
    const older = await insertMedia({ filename: `${stem}-a.png`, mime: 'image/png', minutesAgo: 20 });
    const newer = await insertMedia({ filename: `${stem}-b.png`, mime: 'image/png', minutesAgo: 10 });
    await insertMedia({ filename: `${stem}-c.jpg` });

    const res = await api(`${BASE}?search=${stem.toUpperCase()}&mime_type=image/png`, { token: await adminToken() });
    expectSuccess(res);
    expect(res.body.message).toBe('Media fetched');
    expect(res.body.data.items.map((m: { id: string }) => m.id)).toEqual([newer, older]);
    expect(res.body.data.pagination).toMatchObject({ total: 2 });
  });

  it('validates the filters, 404s a missing row and 403s without media:read', async () => {
    const res = await api(`${BASE}?mime_type=jpeg&search=x`, { token: await adminToken() });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(['search must be longer than or equal to 2 characters', 'mime_type must match /^[\\w.+-]+\\/[\\w.+-]+$/ regular expression']);
    expectError(await api(`${BASE}/${MISSING}`, { token: await adminToken() }), 404, 'NOT_FOUND', 'Media not found');
    expectError(await api(BASE, { token: await tokenWith(['media:update']) }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /media/:id', () => {
  it('updates the filename and alt text only', async () => {
    const id = await insertMedia();
    const res = await api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body: { filename: 'renamed.jpg', alt_text: 'وصف' } });
    expectSuccess(res);
    expect(res.body.message).toBe('Media updated');
    expect(res.body.data).toMatchObject({ id, filename: 'renamed.jpg', alt_text: 'وصف', created_at: expect.stringMatching(ISO_DATE) });
    expect(res.body.data.variants).toBeUndefined();

    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', token: await adminToken(), body: {} }), 404, 'NOT_FOUND', 'Media not found');
    const bad = await api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body: { url: 'https://evil.example/x.jpg' } });
    expectError(bad, 400, 'VALIDATION_FAILED');
    expect(bad.body.errors).toEqual(['property url should not exist']);
  });
});

describe('references and DELETE /media/:id', () => {
  it('lists every record holding the file, trashed ones flagged, and refuses the delete while any does', async () => {
    const id = await insertMedia();
    await withDb((q) => q('INSERT INTO gallery_images (media_id, deleted_at) VALUES ($1, now())', [id]));

    const refs = await api(`${BASE}/${id}/references`, { token: await adminToken() });
    expectSuccess(refs);
    expect(refs.body).toMatchObject({
      message: 'Media references fetched',
      data: { media_id: id, total: 1, shown: 1, truncated: false, items: [{ type: 'gallery_image', id, field: 'gallery_item', trashed: true }] },
    });

    const del = await api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
    expectError(
      del,
      409,
      'MEDIA_IN_USE',
      `Media is still referenced by 1 record (gallery_image ${id} (gallery_item), in the trash). ${IN_USE_HINT} A gallery item uses the media id as its own id, so this file IS that gallery item: delete the gallery item first. Full list: GET /media/${id}/references`,
    );
    expect((await api(`${BASE}/${id}`, { token: await adminToken() })).status).toBe(200);
  });

  it('deletes an unreferenced file, then 404s', async () => {
    const id = await insertMedia();
    const res = await api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Media deleted', data: null });
    expectError(await api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() }), 404, 'NOT_FOUND', 'Media not found');
    expectError(await api(`${BASE}/${MISSING}/references`, { token: await adminToken() }), 404, 'NOT_FOUND', 'Media not found');
  });

  storage('storage (worker only): removes the original and its variants from the bucket', async () => {
    const { key, mediaId } = await uploadUrl('to-delete.png', 'image/png');
    await r2Put(key, images.pngWide.bytes, 'image/png');
    expectSuccess(await confirm(key, { mime_type: 'image/png' }), 201);
    expectSuccess(await api(`${BASE}/${mediaId}/regenerate-variants`, { method: 'POST', token: await adminToken() }));
    expect(await r2Exists(`media/variants/${mediaId}/w768.webp`)).toBe(true);

    expectSuccess(await api(`${BASE}/${mediaId}`, { method: 'DELETE', token: await adminToken() }));
    expect(await r2Exists(key)).toBe(false);
    expect(await r2Exists(`media/variants/${mediaId}/w768.webp`)).toBe(false);
  });
});

describe('POST /media/:id/regenerate-variants', () => {
  it('is 404 for a missing row and 403 without media:update', async () => {
    expectError(await api(`${BASE}/${MISSING}/regenerate-variants`, { method: 'POST', token: await adminToken() }), 404, 'NOT_FOUND', 'Media not found');
    expectError(await api(`${BASE}/${MISSING}/regenerate-variants`, { method: 'POST', token: await tokenWith(['media:read']) }), 403, 'FORBIDDEN');
  });

  storage('storage (worker only): explains a no-variants answer: missing original, animated, too small', async () => {
    const token = await adminToken();
    const regen = async (id: string) => (await api(`${BASE}/${id}/regenerate-variants`, { method: 'POST', token })).body;

    const missing = await regen(await insertMedia());
    expect(missing).toMatchObject({ message: 'Variants regenerated', data: { variants_status: 'unavailable', variants_status_reason: 'ORIGINAL_MISSING' } });

    for (const [fixture, mime, reason, status] of [
      [images.gifAnimated, 'image/gif', 'ANIMATED', 'not_applicable'],
      [images.jpegTiny, 'image/jpeg', 'TOO_SMALL', 'unavailable'],
    ] as const) {
      const { key, mediaId } = await uploadUrl(`f.${mime.split('/')[1]}`, mime);
      await r2Put(key, fixture.bytes, mime);
      expectSuccess(await confirm(key, { mime_type: mime }), 201);
      expect((await regen(mediaId)).data).toMatchObject({ variants_status: status, variants_status_reason: reason });
    }
  });
});

describe('upload-url of audios, books and academic papers', () => {
  it.each([
    ['/api/v1/audios/upload-url', { filename: 'Lecture One.MP3', content_type: 'audio/mpeg' }, /^audio\/[0-9a-f-]{36}\/lecture-one\.mp3$/, 300],
    ['/api/v1/audios/upload-url', { filename: 'notes.pdf', content_type: 'application/pdf' }, /^audio\/pdf\/[0-9a-f-]{36}\/notes\.pdf$/, 50],
    ['/api/v1/books/upload-url', { filename: 'الصحيفة.pdf' }, /^books\/pdf\/[0-9a-f-]{36}\/file\.pdf$/, 150],
    ['/api/v1/academic-papers/upload-url', { filename: 'Thesis 2024.pdf' }, /^academic-papers\/pdf\/[0-9a-f-]{36}\/thesis-2024\.pdf$/, 150],
  ])('%s presigns %j', async (url, body, keyPattern, mb) => {
    const res = await api(url, { method: 'POST', token: await adminToken(), body });
    expectSuccess(res, 201);
    expect(res.body.message).toBe('Upload URL generated');
    expect(Object.keys(res.body.data)).toEqual(['uploadUrl', 'key', 'publicUrl', 'maxBytes']);
    expect(res.body.data.key).toMatch(keyPattern);
    expect(res.body.data.maxBytes).toBe(mb * 1024 * 1024);
    const signed = new URL(res.body.data.uploadUrl);
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('refuses a non-audio type and needs the group’s create permission', async () => {
    const res = await api('/api/v1/audios/upload-url', { method: 'POST', token: await adminToken(), body: { filename: 'x.wav', content_type: 'audio/wav' } });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(['content_type must match /^(audio\\/(mpeg|mp4|x-m4a)|application\\/pdf)$/ regular expression']);
    expectError(await api('/api/v1/books/upload-url', { method: 'POST', token: await tokenWith(['books:update']), body: { filename: 'x.pdf' } }), 403, 'FORBIDDEN');
  });
});
