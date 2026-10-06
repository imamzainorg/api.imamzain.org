import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { assertExactlyOneDefault, loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import type { SpeakerTranslationInput } from './schemas';

type Ctx = Context<AppEnv>;

// The translations plus a count of the speaker's live, published audios (the "N lectures" badge).
const SPEAKER_INCLUDE = {
  speaker_translations: true,
  _count: { select: { audios: { where: { deleted_at: null, is_published: true } } } },
} satisfies Prisma.speakersInclude;

type SpeakerRow = Prisma.speakersGetPayload<{ include: typeof SPEAKER_INCLUDE }>;

function shape(row: SpeakerRow, lang: string | null, active: ReadonlySet<string>) {
  const { _count, ...rest } = row;
  return { ...rest, translation: resolveTranslation(row.speaker_translations, lang, { active }), audio_count: _count.audios };
}

export async function findAll(c: Ctx, query: { page: number; limit: number; search?: string }, lang: string | null) {
  const db = getDb(c);
  const { page, limit, search } = query;
  const where: Prisma.speakersWhereInput = { deleted_at: null };
  if (search) where.speaker_translations = { some: { name: { contains: search, mode: 'insensitive' } } };
  const [rows, total, active] = await Promise.all([
    db.speakers.findMany({
      where,
      include: SPEAKER_INCLUDE,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.speakers.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((r) => shape(r, lang, active));
  return { message: 'Speakers fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null) {
  const db = getDb(c);
  const [speaker, active] = await Promise.all([
    db.speakers.findFirst({ where: { id, deleted_at: null }, include: SPEAKER_INCLUDE }),
    loadActiveLanguages(db),
  ]);
  if (!speaker) throw notFound('Speaker not found');
  return { message: 'Speaker fetched', data: shape(speaker, lang, active) };
}

export async function create(c: Ctx, translations: SpeakerTranslationInput[], lang: string | null) {
  const db = getDb(c);
  assertExactlyOneDefault(translations);

  let created: { id: string };
  try {
    created = await db.$transaction(async (tx) => {
      const speaker = await tx.speakers.create({ data: {} });
      await tx.speaker_translations.createMany({
        data: translations.map((t) => ({ speaker_id: speaker.id, lang: t.lang, name: t.name, is_default: t.is_default ?? false })),
      });
      return speaker;
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'Duplicate translation language for this speaker');
  }

  audit(c, { action: AUDIT_ACTIONS.SPEAKER_CREATED, resourceType: 'speaker', resourceId: created.id, changes: { method: 'POST', path: '/api/v1/speakers' } });

  const { data } = await findOne(c, created.id, lang);
  return { message: 'Speaker created', data };
}

export async function update(c: Ctx, id: string, translations: SpeakerTranslationInput[] | null | undefined, lang: string | null) {
  const db = getDb(c);
  if (!(await db.speakers.findFirst({ where: { id, deleted_at: null }, select: { id: true } }))) throw notFound('Speaker not found');

  if (translations) {
    await db.$transaction(async (tx) => {
      for (const t of translations) {
        const data = { name: t.name, is_default: t.is_default ?? false };
        await tx.speaker_translations.upsert({
          where: { speaker_id_lang: { speaker_id: id, lang: t.lang } },
          create: { speaker_id: id, lang: t.lang, ...data },
          update: data,
        });
      }
      const defaults = await tx.speaker_translations.count({ where: { speaker_id: id, is_default: true } });
      if (defaults !== 1) throw badRequest('Exactly one translation must have is_default: true');
      await tx.speakers.update({ where: { id }, data: { updated_at: new Date() } });
    });
  }

  audit(c, { action: AUDIT_ACTIONS.SPEAKER_UPDATED, resourceType: 'speaker', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/speakers/${id}` } });

  const { data } = await findOne(c, id, lang);
  return { message: 'Speaker updated', data };
}

export async function findTrash(c: Ctx, page: number, limit: number, lang: string | null) {
  const db = getDb(c);
  const where: Prisma.speakersWhereInput = { deleted_at: { not: null } };
  const [rows, total, active] = await Promise.all([
    db.speakers.findMany({
      where,
      include: SPEAKER_INCLUDE,
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.speakers.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((r) => shape(r, lang, active));
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  if (!(await db.speakers.findFirst({ where: { id, deleted_at: { not: null } }, select: { id: true } }))) throw notFound('Deleted speaker not found');
  await db.speakers.update({ where: { id }, data: { deleted_at: null, updated_at: new Date() } });

  audit(c, { action: AUDIT_ACTIONS.SPEAKER_RESTORED, resourceType: 'speaker', resourceId: id, changes: { method: 'POST', path: `/api/v1/speakers/${id}/restore` } });
  return { message: 'Speaker restored', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  if (!(await db.speakers.findFirst({ where: { id, deleted_at: null }, select: { id: true } }))) throw notFound('Speaker not found');

  // The editor must reassign or delete the speaker's live audios first.
  if ((await db.audios.count({ where: { speaker_id: id, deleted_at: null } })) > 0) {
    throw conflict('Cannot delete a speaker that still has audios — reassign them first');
  }
  await db.speakers.update({ where: { id }, data: { deleted_at: new Date() } });

  audit(c, { action: AUDIT_ACTIONS.SPEAKER_DELETED, resourceType: 'speaker', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/speakers/${id}` } });
  return { message: 'Speaker deleted', data: null };
}
