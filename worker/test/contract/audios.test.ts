import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/audios';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A value no earlier run used: the suite runs twice on one DB in CI. */
const uid = () => `au-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const url = (name: string) => `https://example.test/audio/${name}.mp3`;
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, is_default: true, ...extra });
const en = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'en', title, ...extra });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const publish = async (id: string, body: unknown) => api(`${BASE}/${id}/publish`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const admin = async (path: string, lang?: string) => api(`${BASE}${path}`, { token: await adminToken(), lang });

async function newSpeaker(name = uid()): Promise<{ id: string; name: string }> {
  const res = await api('/api/v1/speakers', { method: 'POST', token: await adminToken(), body: { translations: [{ lang: 'ar', name, is_default: true }] } });
  expectSuccess(res, 201);
  return { id: res.body.data.id, name };
}

async function create(body: Record<string, unknown> = {}) {
  const name = uid();
  const res = await post({ audio_url: url(name), translations: [ar(`${name}-ar`), en(`${name}-en`)], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /audios', () => {
  it('creates the audio, defaults to published and answers 201 with the hydrated admin row', async () => {
    const name = uid();
    const speaker = await newSpeaker();
    const res = await post({
      speaker_id: speaker.id,
      audio_url: url(name),
      pdf_url: `https://example.test/audio/${name}.pdf`,
      slug: name,
      duration_seconds: 5188,
      size_mb: 19.84,
      peaks: [0, 0.5, 1],
      translations: [ar(`${name}-ar`), en(`${name}-en`)],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Audio created');
    const data = res.body.data;
    expect(data).toMatchObject({
      speaker_id: speaker.id,
      audio_url: url(name),
      pdf_url: `https://example.test/audio/${name}.pdf`,
      slug: name,
      duration_seconds: 5188,
      size_mb: 19.84,
      peaks: [0, 0.5, 1],
      is_published: true,
      views: 0,
      created_at: expect.stringMatching(ISO_DATE),
      updated_at: expect.stringMatching(ISO_DATE),
      translation: { lang: 'ar', title: `${name}-ar`, is_default: true },
      speaker: { id: speaker.id, translation: { lang: 'ar', name: speaker.name } },
    });
    expect(data.audio_translations).toHaveLength(2);
    expect(data).not.toHaveProperty('speakers');
    expect(data.speaker).not.toHaveProperty('deleted_at');
  });

  it('accepts a minimal body: no speaker, pdf, slug or metrics', async () => {
    const data = await create();
    expect(data).toMatchObject({ speaker_id: null, pdf_url: null, slug: null, duration_seconds: null, size_mb: null, peaks: null, speaker: null });
  });

  it('can create a draft', async () => {
    expect(await create({ is_published: false })).toMatchObject({ is_published: false });
  });

  it('accepts legacy urls with spaces and Arabic characters', async () => {
    const name = uid();
    const legacy = `https://cdn.example.test/audio/المشروع ${name}.mp3`;
    expect(await create({ audio_url: legacy })).toMatchObject({ audio_url: legacy });
  });

  it('refuses a translation set without exactly one default', async () => {
    for (const translations of [[en(uid())], [ar(uid()), ar(uid(), { lang: 'en' })]]) {
      const res = await post({ audio_url: url(uid()), translations });
      expectError(res, 400, 'BAD_REQUEST', 'Exactly one translation must have is_default = true');
    }
  });

  it('404s for an unknown or trashed speaker', async () => {
    expectError(await post({ speaker_id: MISSING, audio_url: url(uid()), translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Speaker not found');

    const speaker = await newSpeaker();
    expectSuccess(await api(`/api/v1/speakers/${speaker.id}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await post({ speaker_id: speaker.id, audio_url: url(uid()), translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Speaker not found');
  });

  it('409s when the slug or the audio_url is taken', async () => {
    const name = uid();
    const first = await create({ slug: name });
    expectError(await post({ slug: name, audio_url: url(uid()), translations: [ar(uid())] }), 409, 'CONFLICT', `Slug "${name}" is already used by another audio`);
    expectError(await post({ audio_url: first.audio_url, translations: [ar(uid())] }), 409, 'CONFLICT', 'An audio with that slug or audio URL already exists');
  });

  describe('validation', () => {
    const t = () => ar(uid());
    const ok = () => ({ audio_url: url(uid()), translations: [t()] });
    const cases: [string, () => unknown, string[]][] = [
      ['a non-http audio_url', () => ({ ...ok(), audio_url: 'ftp://x/y.mp3' }), ['audio_url must be an http(s) URL']],
      ['a 2001-char audio_url', () => ({ ...ok(), audio_url: `https://x/${'a'.repeat(2000)}` }), ['audio_url must be shorter than or equal to 2000 characters']],
      ['a non-http pdf_url', () => ({ ...ok(), pdf_url: 'nope' }), ['pdf_url must be an http(s) URL']],
      ['a malformed speaker_id', () => ({ ...ok(), speaker_id: 'nope' }), ['speaker_id must be a UUID']],
      ['an uppercase slug', () => ({ ...ok(), slug: 'Bad_Slug' }), ['slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']],
      ['a 201-char slug', () => ({ ...ok(), slug: 'a'.repeat(201) }), ['slug must be shorter than or equal to 200 characters']],
      ['a fractional duration', () => ({ ...ok(), duration_seconds: 1.5 }), ['duration_seconds must be an integer number']],
      ['a negative duration', () => ({ ...ok(), duration_seconds: -1 }), ['duration_seconds must not be less than 0']],
      ['a negative size_mb', () => ({ ...ok(), size_mb: -0.5 }), ['size_mb must not be less than 0']],
      ['301 peaks', () => ({ ...ok(), peaks: Array.from({ length: 301 }, () => 0.5) }), ['peaks must contain no more than 300 elements']],
      ['a peak above 1', () => ({ ...ok(), peaks: [2] }), ['each value in peaks must not be greater than 1']],
      ['a negative peak', () => ({ ...ok(), peaks: [-1] }), ['each value in peaks must not be less than 0']],
      ['a non-boolean is_published', () => ({ ...ok(), is_published: 'yes' }), ['is_published must be a boolean value']],
      ['an empty list', () => ({ audio_url: url(uid()), translations: [] }), ['translations must contain at least 1 elements']],
      ['a 51-item list', () => ({ audio_url: url(uid()), translations: Array.from({ length: 51 }, t) }), ['translations must contain no more than 50 elements']],
      ['a three-letter lang', () => ({ audio_url: url(uid()), translations: [{ ...t(), lang: 'abc' }] }), ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['an empty title', () => ({ audio_url: url(uid()), translations: [{ ...t(), title: '' }] }), ['translations.0.title must be longer than or equal to 1 characters']],
      ['a 501-char title', () => ({ audio_url: url(uid()), translations: [{ ...t(), title: 'x'.repeat(501) }] }), ['translations.0.title must be shorter than or equal to 500 characters']],
      ['an unknown translation key', () => ({ audio_url: url(uid()), translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ ...ok(), extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('401s without a token and 403s without audios:create', async () => {
    const body = { audio_url: url(uid()), translations: [ar(uid())] };
    expectError(await api(BASE, { method: 'POST', body }), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { method: 'POST', token: await tokenWith(['audios:read']), body }), 403, 'FORBIDDEN');
  });
});

describe('GET /audios', () => {
  it('lists published audios only, newest first, without peaks, and is CDN-cacheable', async () => {
    const live = await create({ peaks: [0.1, 0.2] });
    const draft = await create({ is_published: false });
    const gone = await create();
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?limit=100`);
    expectSuccess(res);
    expect(res.body.message).toBe('Audios fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    const ids = idsOf(res);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(gone.id);
    expect(res.body.data.items[0]).not.toHaveProperty('peaks');
    expect(res.body.data.items[0]).not.toHaveProperty('speakers');
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('paginates with a stable order', async () => {
    await create();
    await create();
    const page1 = await api(`${BASE}?page=1&limit=1`);
    const page2 = await api(`${BASE}?page=2&limit=1`);
    expect(idsOf(page1)).toHaveLength(1);
    expect(idsOf(page1)[0]).not.toBe(idsOf(page2)[0]);
  });

  it('filters by speaker and resolves the translation by Accept-Language', async () => {
    const speaker = await newSpeaker();
    const name = uid();
    const mine = await create({ speaker_id: speaker.id, translations: [ar(`${name}-ar`), en(`${name}-en`)] });
    await create();

    const res = await api(`${BASE}?speaker_id=${speaker.id}`, { lang: 'en' });
    expect(idsOf(res)).toEqual([mine.id]);
    expect(res.body.data.items[0].translation).toMatchObject({ lang: 'en', title: `${name}-en` });
  });

  it('searches the title and the speaker name, case-insensitively', async () => {
    const needle = uid();
    const speaker = await newSpeaker(`spk-${needle}`);
    const byTitle = await create({ translations: [ar(`Title ${needle.toUpperCase()}`)] });
    const bySpeaker = await create({ speaker_id: speaker.id });
    await create();

    const res = await api(`${BASE}?search=${needle}`);
    expect(idsOf(res).sort()).toEqual([byTitle.id, bySpeaker.id].sort());
  });

  it('hides a trashed speaker from the public: name, relation and search', async () => {
    const needle = uid();
    const speaker = await newSpeaker(`spk-${needle}`);
    const audio = await create({ speaker_id: speaker.id });
    await withDb((q) => q('UPDATE speakers SET deleted_at = now() WHERE id = $1', [speaker.id]));

    const pub = await api(`${BASE}/${audio.id}`);
    expectSuccess(pub);
    expect(pub.body.data.speaker).toBeNull();
    expect(idsOf(await api(`${BASE}?search=${needle}`))).toEqual([]);

    const cms = await admin(`/admin/${audio.id}`);
    expect(cms.body.data.speaker).toMatchObject({ id: speaker.id });
    expect(idsOf(await admin(`/admin?search=${needle}`))).toEqual([audio.id]);
  });

  it('rejects bad query parameters', async () => {
    expect(errorsOf(await api(`${BASE}?speaker_id=nope`))).toEqual(['speaker_id must be a UUID']);
    expect(errorsOf(await api(`${BASE}?search=a`))).toEqual(['search must be longer than or equal to 2 characters']);
    expect(errorsOf(await api(`${BASE}?limit=101`))).toEqual(['limit must not be greater than 100']);
    expect(errorsOf(await api(`${BASE}?extra=1`))).toEqual(['property extra should not exist']);
  });

  it('ignores a blank search', async () => {
    expectSuccess(await api(`${BASE}?search=%20%20`));
  });
});

describe('GET /audios/admin', () => {
  it('includes drafts, filters by is_published and needs audios:read', async () => {
    const live = await create();
    const draft = await create({ is_published: false });

    const all = await admin('/admin?limit=100');
    expectSuccess(all);
    expect(idsOf(all)).toEqual(expect.arrayContaining([live.id, draft.id]));
    expect(idsOf(await admin('/admin?limit=100&is_published=false'))).toContain(draft.id);
    expect(idsOf(await admin('/admin?limit=100&is_published=false'))).not.toContain(live.id);
    expect(idsOf(await admin('/admin?limit=100&is_published=true'))).not.toContain(draft.id);

    expect(errorsOf(await admin('/admin?is_published=yes'))).toEqual(['is_published must be a boolean value']);
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['audios:create']) }), 403, 'FORBIDDEN');
  });

  it('GET /admin/:id returns a draft with peaks, 404s a trashed or missing audio', async () => {
    const draft = await create({ is_published: false, peaks: [0.3] });
    const res = await admin(`/admin/${draft.id}`);
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ id: draft.id, peaks: [0.3] });

    expectSuccess(await del(draft.id));
    expectError(await admin(`/admin/${draft.id}`), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await admin(`/admin/${MISSING}`), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await api(`${BASE}/admin/${MISSING}`), 401, 'UNAUTHORIZED');
  });
});

describe('GET /audios/:id and /by-slug/:slug', () => {
  it('serves a published audio with peaks and caches it', async () => {
    const audio = await create({ peaks: [0.4], slug: uid() });
    const res = await api(`${BASE}/${audio.id}`);
    expectSuccess(res);
    expect(res.body.message).toBe('Audio fetched');
    expect(res.body.data).toMatchObject({ id: audio.id, peaks: [0.4] });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');

    const bySlug = await api(`${BASE}/by-slug/${audio.slug}`);
    expectSuccess(bySlug);
    expect(bySlug.body.data.id).toBe(audio.id);
    expect(bySlug.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  });

  it('404s a draft, a trashed audio, a missing id and an unknown slug; 400s a malformed id', async () => {
    const draft = await create({ is_published: false, slug: uid() });
    expectError(await api(`${BASE}/${draft.id}`), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await api(`${BASE}/by-slug/${draft.slug}`), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await api(`${BASE}/${MISSING}`), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await api(`${BASE}/by-slug/${uid()}`), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');

    const live = await create({ slug: uid() });
    expectSuccess(await del(live.id));
    expectError(await api(`${BASE}/${live.id}`), 404, 'NOT_FOUND', 'Audio not found');
  });
});

describe('POST /audios/:id/view', () => {
  it('counts a view on a published audio and answers 201', async () => {
    const audio = await create();
    const res = await api(`${BASE}/${audio.id}/view`, { method: 'POST' });
    expectSuccess(res, 201);
    expect(res.body).toMatchObject({ message: 'View tracked', data: null });
    await api(`${BASE}/${audio.id}/view`, { method: 'POST' });
    expect((await admin(`/admin/${audio.id}`)).body.data.views).toBe(2);
  });

  it('404s a draft, a trashed audio and a missing id', async () => {
    const draft = await create({ is_published: false });
    expectError(await api(`${BASE}/${draft.id}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Audio not found');
    expectError(await api(`${BASE}/${MISSING}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Audio not found');
    expect((await admin(`/admin/${draft.id}`)).body.data.views).toBe(0);
  });

  it('is limited to 30 per minute per IP', async () => {
    const ip = `10.99.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}`;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await api(`${BASE}/${MISSING}/view`, { method: 'POST', ip })).status;
    expect(last).toBe(429);
  });
});

describe('PATCH /audios/:id', () => {
  it('updates fields, upserts translations by language and keeps the rest', async () => {
    const speaker = await newSpeaker();
    const audio = await create({ slug: uid(), duration_seconds: 10 });
    const title = uid();

    const res = await patch(audio.id, { speaker_id: speaker.id, duration_seconds: 99, size_mb: 1.5, translations: [en(title, { is_default: false }), ar(`${title}-ar`)] });
    expectSuccess(res);
    expect(res.body.message).toBe('Audio updated');
    expect(res.body.data).toMatchObject({ speaker_id: speaker.id, duration_seconds: 99, size_mb: 1.5, slug: audio.slug, audio_url: audio.audio_url });
    expect(res.body.data.audio_translations).toHaveLength(2);
    expect(res.body.data.audio_translations).toContainEqual({ lang: 'en', title, is_default: false });
    expect(Date.parse(res.body.data.updated_at)).toBeGreaterThan(Date.parse(audio.updated_at) - 1);
  });

  it('clears the speaker and the pdf with null', async () => {
    const speaker = await newSpeaker();
    const audio = await create({ speaker_id: speaker.id, pdf_url: `https://example.test/${uid()}.pdf` });
    const res = await patch(audio.id, { speaker_id: null, pdf_url: null });
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ speaker_id: null, pdf_url: null, speaker: null });
  });

  it('refuses a translation set that ends without exactly one default, and rolls everything back', async () => {
    const audio = await create({ duration_seconds: 5 });
    const res = await patch(audio.id, { duration_seconds: 77, translations: [en(uid(), { is_default: true })] });
    expectError(res, 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
    expect((await admin(`/admin/${audio.id}`)).body.data).toMatchObject({ duration_seconds: 5 });
  });

  it('409s a slug used by another audio, but not the audio’s own slug', async () => {
    const taken = await create({ slug: uid() });
    const audio = await create({ slug: uid() });
    expectError(await patch(audio.id, { slug: taken.slug }), 409, 'CONFLICT', `Slug "${taken.slug}" is already used by another audio`);
    expectSuccess(await patch(audio.id, { slug: audio.slug }));
  });

  it('409s an audio_url used by another audio', async () => {
    const taken = await create();
    const audio = await create();
    expectError(await patch(audio.id, { audio_url: taken.audio_url }), 409, 'CONFLICT', 'An audio with that slug or audio URL already exists');
  });

  it('404s an unknown speaker, a missing audio and a trashed audio', async () => {
    const audio = await create();
    expectError(await patch(audio.id, { speaker_id: MISSING }), 404, 'NOT_FOUND', 'Speaker not found');
    expectError(await patch(MISSING, { size_mb: 1 }), 404, 'NOT_FOUND', 'Audio not found');
    expectSuccess(await del(audio.id));
    expectError(await patch(audio.id, { size_mb: 1 }), 404, 'NOT_FOUND', 'Audio not found');
  });

  it('rejects bad bodies and needs audios:update', async () => {
    const audio = await create();
    expect(errorsOf(await patch(audio.id, { audio_url: 'nope' }))).toEqual(['audio_url must be an http(s) URL']);
    expect(errorsOf(await patch(audio.id, { slug: 'Bad Slug' }))).toEqual(['slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']);
    expect(errorsOf(await patch(audio.id, { translations: [{ lang: 'ar', title: '' }] }))).toEqual(['translations.0.title must be longer than or equal to 1 characters']);
    expect(errorsOf(await patch(audio.id, { extra: 1 }))).toEqual(['property extra should not exist']);
    expectError(await api(`${BASE}/${audio.id}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${audio.id}`, { method: 'PATCH', token: await tokenWith(['audios:read']), body: {} }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /audios/:id/publish', () => {
  it('publishes and unpublishes, and answers "already" for a no-op', async () => {
    const audio = await create({ is_published: false });

    const on = await publish(audio.id, { is_published: true });
    expectSuccess(on);
    expect(on.body).toMatchObject({ message: 'Audio published', data: { id: audio.id, is_published: true } });
    expectSuccess(await api(`${BASE}/${audio.id}`));

    const again = await publish(audio.id, { is_published: true });
    expectSuccess(again);
    expect(again.body.message).toBe('Audio already in requested state');

    const off = await publish(audio.id, { is_published: false });
    expect(off.body).toMatchObject({ message: 'Audio unpublished', data: { is_published: false } });
    expectError(await api(`${BASE}/${audio.id}`), 404, 'NOT_FOUND');
  });

  it('404s a missing or trashed audio; validates the body; needs audios:update', async () => {
    const audio = await create();
    expectError(await publish(MISSING, { is_published: true }), 404, 'NOT_FOUND', 'Audio not found');
    expect(errorsOf(await publish(audio.id, { is_published: 'yes' }))).toEqual(['is_published must be a boolean value']);
    expect(errorsOf(await publish(audio.id, {}))).toEqual(['is_published must be a boolean value']);
    expectError(await api(`${BASE}/${audio.id}/publish`, { method: 'PATCH', token: await tokenWith(['audios:read']), body: { is_published: true } }), 403, 'FORBIDDEN');
    expectSuccess(await del(audio.id));
    expectError(await publish(audio.id, { is_published: true }), 404, 'NOT_FOUND', 'Audio not found');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes, frees the slug and audio_url, and shows the original values in the trash', async () => {
    const audio = await create({ slug: uid() });

    const res = await del(audio.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Audio deleted', data: null });
    expectError(await del(audio.id), 404, 'NOT_FOUND', 'Audio not found');

    // The freed slug and url can be claimed again.
    const reuse = await post({ slug: audio.slug, audio_url: audio.audio_url, translations: [ar(uid())] });
    expectSuccess(reuse, 201);

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const row = trash.body.data.items.find((i: { id: string }) => i.id === audio.id);
    expect(row).toMatchObject({ slug: audio.slug, audio_url: audio.audio_url });
    expect(row).not.toHaveProperty('peaks');
  });

  it('restores under the original slug and audio_url', async () => {
    const audio = await create({ slug: uid() });
    await del(audio.id);

    const res = await restore(audio.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Audio restored', data: null });
    expect((await admin(`/admin/${audio.id}`)).body.data).toMatchObject({ slug: audio.slug, audio_url: audio.audio_url });
    expectError(await restore(audio.id), 404, 'NOT_FOUND', 'Deleted audio not found');
  });

  it('refuses to restore over a slug or audio_url a live audio claimed meanwhile', async () => {
    const bySlug = await create({ slug: uid() });
    await del(bySlug.id);
    await create({ slug: bySlug.slug });
    expectError(await restore(bySlug.id), 409, 'CONFLICT', `Cannot restore: slug "${bySlug.slug}" is now used by another audio`);

    const byUrl = await create();
    await del(byUrl.id);
    await create({ audio_url: byUrl.audio_url });
    expectError(await restore(byUrl.id), 409, 'CONFLICT', `Cannot restore: audio_url "${byUrl.audio_url}" is now used by another audio`);
  });

  it('refuses to restore an audio whose speaker is in the trash, with AUDIO_SPEAKER_DELETED', async () => {
    const speaker = await newSpeaker();
    const audio = await create({ speaker_id: speaker.id });
    await del(audio.id);
    // The speaker only blocks deletion while it has LIVE audios, so it can go to the trash now.
    expectSuccess(await api(`/api/v1/speakers/${speaker.id}`, { method: 'DELETE', token: await adminToken() }));

    expectError(await restore(audio.id), 409, 'AUDIO_SPEAKER_DELETED', 'Cannot restore: the speaker of this audio was deleted — restore the speaker first');

    expectSuccess(await api(`/api/v1/speakers/${speaker.id}/restore`, { method: 'POST', token: await adminToken() }));
    expectSuccess(await restore(audio.id));
  });

  it('401s and 403s on the destructive routes', async () => {
    const audio = await create();
    const weak = await tokenWith(['audios:read']);
    for (const [method, path] of [
      ['GET', '/trash'],
      ['DELETE', `/${audio.id}`],
      ['POST', `/${audio.id}/restore`],
    ]) {
      expectError(await api(`${BASE}${path}`, { method }), 401, 'UNAUTHORIZED');
      expectError(await api(`${BASE}${path}`, { method, token: weak }), 403, 'FORBIDDEN');
    }
  });

  it('400s a malformed id on delete and restore', async () => {
    expectError(await del('nope'), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
    expectError(await restore('nope'), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });
});
