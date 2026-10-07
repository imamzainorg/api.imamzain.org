import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { currentUser } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { assertExactlyOneDefault, loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta } from '../../lib/pagination';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../../lib/soft-delete';
import type { AppEnv } from '../../lib/types';
import type { CreateAudioInput, UpdateAudioInput } from './schemas';

type Ctx = Context<AppEnv>;

/** Stable code for the 409 raised when an audio is restored under a trashed speaker. */
export const AUDIO_SPEAKER_DELETED = 'AUDIO_SPEAKER_DELETED';

// `deleted_at` is read only to decide visibility (shapeSpeaker) and never leaves the service.
const SPEAKER_SELECT = {
  id: true,
  deleted_at: true,
  speaker_translations: { select: { lang: true, name: true, is_default: true } },
} satisfies Prisma.speakersSelect;

// List payloads drop the heavy `peaks` waveform array (detail-only).
const AUDIO_LIST_SELECT = {
  id: true,
  speaker_id: true,
  audio_url: true,
  pdf_url: true,
  slug: true,
  duration_seconds: true,
  size_mb: true,
  is_published: true,
  views: true,
  created_at: true,
  updated_at: true,
  audio_translations: { select: { lang: true, title: true, is_default: true } },
  speakers: { select: SPEAKER_SELECT },
} satisfies Prisma.audiosSelect;

const AUDIO_DETAIL_SELECT = { ...AUDIO_LIST_SELECT, peaks: true } satisfies Prisma.audiosSelect;

type SpeakerRow = {
  id: string;
  deleted_at: Date | null;
  speaker_translations: { lang: string; name: string; is_default: boolean }[];
};

interface ListFilters {
  page: number;
  limit: number;
  speaker_id?: string;
  search?: string;
  is_published?: boolean;
}

/**
 * A trashed speaker is hidden from the public (`speaker: null`): an audio can outlive its speaker's
 * soft delete, and the name must not keep being served. The CMS still sees it.
 */
function shapeSpeaker(speaker: SpeakerRow | null, lang: string | null, isPublic: boolean, active: ReadonlySet<string>) {
  if (!speaker) return null;
  const { deleted_at, ...rest } = speaker;
  if (isPublic && deleted_at) return null;
  return { ...rest, translation: resolveTranslation(speaker.speaker_translations, lang, { active }) };
}

function shapeAudio<T extends { audio_translations: { lang: string; is_default: boolean }[]; speakers?: SpeakerRow | null }>(
  row: T,
  lang: string | null,
  isPublic: boolean,
  active: ReadonlySet<string>,
) {
  const { speakers, ...rest } = row;
  return {
    ...rest,
    translation: resolveTranslation(row.audio_translations, lang, { active }),
    speaker: shapeSpeaker(speakers ?? null, lang, isPublic, active),
  };
}

async function assertSlugAvailable(c: Ctx, slug: string, excludeId: string | null) {
  const clash = await getDb(c).audios.findFirst({
    where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`Slug "${slug}" is already used by another audio`);
}

async function assertSpeakerExists(c: Ctx, speakerId: string) {
  const speaker = await getDb(c).speakers.findFirst({ where: { id: speakerId, deleted_at: null }, select: { id: true } });
  if (!speaker) throw notFound('Speaker not found');
}

/** The public never matches on a trashed speaker's name: that would confirm a name the response hides. */
function applySearch(where: Prisma.audiosWhereInput, search: string, isPublic: boolean) {
  where.OR = [
    { audio_translations: { some: { title: { contains: search, mode: 'insensitive' } } } },
    {
      speakers: {
        ...(isPublic ? { deleted_at: null } : {}),
        speaker_translations: { some: { name: { contains: search, mode: 'insensitive' } } },
      },
    },
  ];
}

async function listWith(c: Ctx, where: Prisma.audiosWhereInput, f: ListFilters, lang: string | null, isPublic: boolean) {
  const db = getDb(c);
  const [rows, total, active] = await Promise.all([
    db.audios.findMany({
      where,
      select: AUDIO_LIST_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    db.audios.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((r) => shapeAudio(r, lang, isPublic, active));
  return { message: 'Audios fetched', data: { items, pagination: buildPaginationMeta(f.page, f.limit, total) } };
}

export function findAllPublic(c: Ctx, f: ListFilters, lang: string | null) {
  const where: Prisma.audiosWhereInput = { deleted_at: null, is_published: true };
  if (f.speaker_id) where.speaker_id = f.speaker_id;
  if (f.search) applySearch(where, f.search, true);
  return listWith(c, where, f, lang, true);
}

export function findAllAdmin(c: Ctx, f: ListFilters, lang: string | null) {
  const where: Prisma.audiosWhereInput = { deleted_at: null };
  if (f.is_published !== undefined) where.is_published = f.is_published;
  if (f.speaker_id) where.speaker_id = f.speaker_id;
  if (f.search) applySearch(where, f.search, false);
  return listWith(c, where, f, lang, false);
}

/** Public callers only see published rows: a draft must not be readable just because its UUID is known. */
export async function findOne(c: Ctx, id: string, lang: string | null, opts: { allowUnpublished?: boolean } = {}) {
  const db = getDb(c);
  const where: Prisma.audiosWhereInput = { id, deleted_at: null };
  if (!opts.allowUnpublished) where.is_published = true;
  const [audio, active] = await Promise.all([db.audios.findFirst({ where, select: AUDIO_DETAIL_SELECT }), loadActiveLanguages(db)]);
  if (!audio) throw notFound('Audio not found');
  return { message: 'Audio fetched', data: shapeAudio(audio, lang, !opts.allowUnpublished, active) };
}

export async function findBySlug(c: Ctx, slug: string, lang: string | null) {
  const db = getDb(c);
  const [audio, active] = await Promise.all([
    db.audios.findFirst({ where: { slug, deleted_at: null, is_published: true }, select: AUDIO_DETAIL_SELECT }),
    loadActiveLanguages(db),
  ]);
  if (!audio) throw notFound('Audio not found');
  return { message: 'Audio fetched', data: shapeAudio(audio, lang, true, active) };
}

export async function trackView(c: Ctx, id: string) {
  const result = await getDb(c).audios.updateMany({
    where: { id, deleted_at: null, is_published: true },
    data: { views: { increment: 1 } },
  });
  if (result.count === 0) throw notFound('Audio not found');
  return { message: 'View tracked', data: null };
}

export async function create(c: Ctx, input: CreateAudioInput, lang: string | null) {
  const db = getDb(c);
  assertExactlyOneDefault(input.translations);
  if (input.speaker_id) await assertSpeakerExists(c, input.speaker_id);
  if (input.slug) await assertSlugAvailable(c, input.slug, null);

  let created: { id: string };
  try {
    created = await db.$transaction(async (tx) => {
      const audio = await tx.audios.create({
        data: {
          speaker_id: input.speaker_id ?? null,
          audio_url: input.audio_url,
          pdf_url: input.pdf_url ?? null,
          slug: input.slug ?? null,
          duration_seconds: input.duration_seconds ?? null,
          size_mb: input.size_mb ?? null,
          peaks: input.peaks ?? undefined,
          is_published: input.is_published ?? true,
          added_by: currentUser(c).id,
        },
      });
      await tx.audio_translations.createMany({
        data: input.translations.map((t) => ({ audio_id: audio.id, lang: t.lang, title: t.title, is_default: t.is_default ?? false })),
      });
      return audio;
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'An audio with that slug or audio URL already exists');
  }

  audit(c, { action: AUDIT_ACTIONS.AUDIO_CREATED, resourceType: 'audio', resourceId: created.id, changes: { method: 'POST', path: '/api/v1/audios' } });

  const { data } = await findOne(c, created.id, lang, { allowUnpublished: true });
  return { message: 'Audio created', data };
}

export async function update(c: Ctx, id: string, input: UpdateAudioInput, lang: string | null) {
  const db = getDb(c);
  const audio = await db.audios.findFirst({ where: { id, deleted_at: null }, select: { id: true } });
  if (!audio) throw notFound('Audio not found');

  if (input.speaker_id) await assertSpeakerExists(c, input.speaker_id);
  if (input.slug) await assertSlugAvailable(c, input.slug, id);

  try {
    await db.$transaction(async (tx) => {
      // An explicit input: request fields never reach columns that weren't meant to change.
      const data = { updated_at: new Date() } as Prisma.audiosUpdateInput;
      if (input.speaker_id !== undefined) {
        data.speakers = input.speaker_id ? { connect: { id: input.speaker_id } } : { disconnect: true };
      }
      if (input.audio_url !== undefined) data.audio_url = input.audio_url as string;
      if (input.pdf_url !== undefined) data.pdf_url = input.pdf_url;
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.duration_seconds !== undefined) data.duration_seconds = input.duration_seconds;
      if (input.size_mb !== undefined) data.size_mb = input.size_mb;
      if (input.peaks !== undefined) data.peaks = input.peaks as Prisma.InputJsonValue;
      if (input.is_published !== undefined) data.is_published = input.is_published as boolean;

      await tx.audios.update({ where: { id }, data });

      if (input.translations) {
        for (const t of input.translations) {
          const row = { title: t.title, is_default: t.is_default ?? false };
          await tx.audio_translations.upsert({
            where: { audio_id_lang: { audio_id: id, lang: t.lang } },
            create: { audio_id: id, lang: t.lang, ...row },
            update: row,
          });
        }
        const defaults = await tx.audio_translations.count({ where: { audio_id: id, is_default: true } });
        if (defaults !== 1) throw badRequest('Exactly one translation must have is_default: true');
      }
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'An audio with that slug or audio URL already exists');
  }

  audit(c, { action: AUDIT_ACTIONS.AUDIO_UPDATED, resourceType: 'audio', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/audios/${id}` } });

  const { data } = await findOne(c, id, lang, { allowUnpublished: true });
  return { message: 'Audio updated', data };
}

export async function togglePublish(c: Ctx, id: string, isPublished: boolean, lang: string | null) {
  const db = getDb(c);
  const existing = await db.audios.findFirst({ where: { id, deleted_at: null }, select: { id: true, is_published: true } });
  if (!existing) throw notFound('Audio not found');

  if (existing.is_published === isPublished) {
    const { data } = await findOne(c, id, lang, { allowUnpublished: true });
    return { message: 'Audio already in requested state', data };
  }

  await db.audios.update({ where: { id }, data: { is_published: isPublished, updated_at: new Date() } });

  audit(c, {
    action: isPublished ? AUDIT_ACTIONS.AUDIO_PUBLISHED : AUDIT_ACTIONS.AUDIO_UNPUBLISHED,
    resourceType: 'audio',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/audios/${id}/publish`, is_published: isPublished },
  });

  const { data } = await findOne(c, id, lang, { allowUnpublished: true });
  return { message: isPublished ? 'Audio published' : 'Audio unpublished', data };
}

/** Soft-deleted audios, with the `__del_` suffix stripped from slug and audio_url for display. */
export async function findTrash(c: Ctx, page: number, limit: number, lang: string | null) {
  const db = getDb(c);
  const where: Prisma.audiosWhereInput = { deleted_at: { not: null } };
  const [rows, total, active] = await Promise.all([
    db.audios.findMany({
      where,
      select: AUDIO_LIST_SELECT,
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.audios.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((r) => {
    const shaped = shapeAudio(r, lang, false, active);
    return {
      ...shaped,
      slug: shaped.slug ? stripSoftDeleteSuffix(shaped.slug) : shaped.slug,
      audio_url: stripSoftDeleteSuffix(shaped.audio_url),
    };
  });
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const audio = await db.audios.findFirst({
    where: { id, deleted_at: { not: null } },
    select: { id: true, slug: true, audio_url: true, speakers: { select: { deleted_at: true } } },
  });
  if (!audio) throw notFound('Deleted audio not found');

  // Speaker soft delete only blocks on LIVE audios, so a trashed audio can keep pointing at a trashed
  // speaker; restoring it would publish that speaker's name again.
  if (audio.speakers?.deleted_at) {
    throw conflict('Cannot restore: the speaker of this audio was deleted — restore the speaker first', { code: AUDIO_SPEAKER_DELETED });
  }

  const original = audio.slug ? stripSoftDeleteSuffix(audio.slug) : null;
  const originalAudioUrl = stripSoftDeleteSuffix(audio.audio_url);

  try {
    await db.$transaction(async (tx) => {
      if (original) {
        const clash = await tx.audios.findFirst({ where: { slug: original, deleted_at: null, NOT: { id } }, select: { id: true } });
        if (clash) throw conflict(`Cannot restore: slug "${original}" is now used by another audio`);
      }
      const urlClash = await tx.audios.findFirst({ where: { audio_url: originalAudioUrl, deleted_at: null, NOT: { id } }, select: { id: true } });
      if (urlClash) throw conflict(`Cannot restore: audio_url "${originalAudioUrl}" is now used by another audio`);
      await tx.audios.update({
        where: { id },
        data: { deleted_at: null, audio_url: originalAudioUrl, ...(original ? { slug: original } : {}), updated_at: new Date() },
      });
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'Cannot restore: the original slug or audio_url was claimed by another audio');
  }

  audit(c, { action: AUDIT_ACTIONS.AUDIO_RESTORED, resourceType: 'audio', resourceId: id, changes: { method: 'POST', path: `/api/v1/audios/${id}/restore` } });

  return { message: 'Audio restored', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const audio = await db.audios.findFirst({ where: { id, deleted_at: null }, select: { id: true, slug: true, audio_url: true } });
  if (!audio) throw notFound('Audio not found');

  // Suffixing frees the unique slug and audio_url while the row sits in trash; restore reverses both.
  // audio_url is never null (unlike slug), so it is always suffixed.
  const deletedAt = new Date();
  const suffix = softDeleteSuffix(deletedAt);
  await db.audios.update({
    where: { id },
    data: { deleted_at: deletedAt, audio_url: `${audio.audio_url}${suffix}`, ...(audio.slug ? { slug: `${audio.slug}${suffix}` } : {}) },
  });

  audit(c, { action: AUDIT_ACTIONS.AUDIO_DELETED, resourceType: 'audio', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/audios/${id}` } });

  return { message: 'Audio deleted', data: null };
}
