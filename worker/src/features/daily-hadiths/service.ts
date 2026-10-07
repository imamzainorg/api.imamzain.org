import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS, type AuditAction } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { badRequest, isUniqueViolation, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import { siteDate, siteTimezone } from '../../lib/site-time';
import type { AppEnv } from '../../lib/types';
import type { HadithTranslationInput } from './schemas';

type Ctx = Context<AppEnv>;

// 'ar' < 'en' < 'fa': the fallback in resolveTranslation lands on Arabic deterministically.
const WITH_TRANSLATIONS = { daily_hadith_translations: { orderBy: { lang: 'asc' as const } } };

type TranslationRow = { lang: string; content: string; source: string | null };
type HadithRow = { id: string; display_date: Date | null; daily_hadith_translations: TranslationRow[] };

// ── Public ─────────────────────────────────────────────────────────────

export async function getToday(c: Ctx, lang: string | null) {
  const db = getDb(c);
  const dateOnly = siteDate(siteTimezone(c.env.SITE_TIMEZONE));
  const today = dateOnlyToDbDate(dateOnly);

  const scheduled = await db.daily_hadiths.findFirst({ where: { deleted_at: null, display_date: today }, include: WITH_TRANSLATIONS });
  if (scheduled) {
    return { message: "Today's hadith", data: formatPick(scheduled, lang, await loadActiveLanguages(db)), meta: { date: dateOnly, source: 'scheduled' as const } };
  }

  const locked = await db.daily_hadith_random_picks.findUnique({ where: { pick_date: today } });
  if (locked) return formatTodayPick(c, locked.hadith_id, lang, dateOnly);

  const undated = await db.daily_hadiths.findMany({ where: { deleted_at: null, display_date: null }, select: { id: true } });
  const hadithId = undated.length > 0 ? undated[Math.floor(Math.random() * undated.length)]!.id : null;

  try {
    await db.daily_hadith_random_picks.create({ data: { pick_date: today, hadith_id: hadithId } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent request locked today's pick first: converge on whichever hadith actually won.
    const winner = await db.daily_hadith_random_picks.findUniqueOrThrow({ where: { pick_date: today } });
    return formatTodayPick(c, winner.hadith_id, lang, dateOnly);
  }
  return formatTodayPick(c, hadithId, lang, dateOnly);
}

/** A pure read (never the random fallback, that is `/today`'s job): by `date`, by `from`/`to`, or a plain browse. */
export async function findPublic(c: Ctx, query: { page: number; limit: number; date?: string; from?: string; to?: string }, lang: string | null) {
  if (query.date && (query.from || query.to)) throw badRequest('date cannot be combined with from/to');
  if (Boolean(query.from) !== Boolean(query.to)) throw badRequest('from and to must be provided together');

  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);
  const where: Prisma.daily_hadithsWhereInput = {
    deleted_at: null,
    // A hadith whose only translation is in a retired language resolves to null; keep it out of the page and the total.
    daily_hadith_translations: { some: { languages: { is_active: true, deleted_at: null } } },
  };
  let orderBy: Prisma.daily_hadithsOrderByWithRelationInput[] = [{ created_at: 'desc' }, { id: 'asc' }];

  if (query.date) {
    where.display_date = parseDateOnly(query.date, 'date');
    orderBy = [{ display_date: 'asc' }, { id: 'asc' }];
  } else if (query.from && query.to) {
    const from = parseDateOnly(query.from, 'from');
    const to = parseDateOnly(query.to, 'to');
    if (from.getTime() > to.getTime()) throw badRequest('from must be on or before to');
    where.display_date = { gte: from, lte: to };
    orderBy = [{ display_date: 'asc' }, { id: 'asc' }];
  }

  const [items, total, active] = await Promise.all([
    db.daily_hadiths.findMany({ where, include: WITH_TRANSLATIONS, orderBy, skip, take: limit }),
    db.daily_hadiths.count({ where }),
    loadActiveLanguages(db),
  ]);

  return {
    message: 'Hadiths fetched',
    data: { items: items.map((h) => toPublicItem(h, lang, active)).filter((item) => item !== null), pagination: buildPaginationMeta(page, limit, total) },
  };
}

// ── Admin (CMS) ────────────────────────────────────────────────────────

export async function findAll(c: Ctx, query: { page: number; limit: number }, lang: string | null) {
  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);
  const where: Prisma.daily_hadithsWhereInput = { deleted_at: null };

  const [items, total, active] = await Promise.all([
    db.daily_hadiths.findMany({ where, include: WITH_TRANSLATIONS, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
    db.daily_hadiths.count({ where }),
    loadActiveLanguages(db),
  ]);

  return { message: 'Hadiths fetched', data: { items: items.map((h) => toAdminItem(h, lang, active)), pagination: buildPaginationMeta(page, limit, total) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null) {
  const db = getDb(c);
  const hadith = await db.daily_hadiths.findFirst({ where: { id, deleted_at: null }, include: WITH_TRANSLATIONS });
  if (!hadith) throw notFound('Hadith not found');
  return { message: 'Hadith fetched', data: toAdminItem(hadith, lang, await loadActiveLanguages(db)) };
}

export async function create(c: Ctx, body: { display_date?: string | null; translations: HadithTranslationInput[] }) {
  const db = getDb(c);
  assertUniqueLanguages(body.translations);
  const displayDate = body.display_date ? parseDateOnly(body.display_date, 'display_date') : null;

  let hadith;
  try {
    hadith = await db.$transaction(async (tx) => {
      const created = await tx.daily_hadiths.create({ data: { display_date: displayDate } });
      await tx.daily_hadith_translations.createMany({
        data: body.translations.map((t) => ({ hadith_id: created.id, lang: t.lang, content: t.content, source: t.source ?? null })),
      });
      return created;
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'Another hadith is already scheduled to that date');
  }

  if (displayDate === null) await releaseEmptyPick(c);
  writeAudit(c, AUDIT_ACTIONS.DAILY_HADITH_CREATED, hadith.id, { method: 'POST', path: '/api/v1/daily-hadiths' });

  return { message: 'Hadith created', data: hadith };
}

export async function update(c: Ctx, id: string, body: { display_date?: string | null; translations?: HadithTranslationInput[] | null }) {
  const db = getDb(c);
  assertUniqueLanguages(body.translations);
  const hadith = await db.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
  if (!hadith) throw notFound('Hadith not found');

  try {
    await db.$transaction(async (tx) => {
      const data: Prisma.daily_hadithsUpdateInput = { updated_at: new Date() };
      if (body.display_date !== undefined) {
        data.display_date = body.display_date === null ? null : parseDateOnly(body.display_date, 'display_date');
      }
      await tx.daily_hadiths.update({ where: { id }, data });

      if (body.translations) {
        for (const t of body.translations) {
          const trData = { content: t.content, source: t.source ?? null };
          await tx.daily_hadith_translations.upsert({
            where: { hadith_id_lang: { hadith_id: id, lang: t.lang } },
            create: { hadith_id: id, lang: t.lang, ...trData },
            update: trData,
          });
        }
      }
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'Another hadith is already scheduled to that date');
  }

  // Unscheduled after this write (newly, or it already was): it is in the pool the random fallback draws from.
  const unscheduled = body.display_date === undefined ? hadith.display_date === null : body.display_date === null;
  if (unscheduled) await releaseEmptyPick(c);

  writeAudit(c, AUDIT_ACTIONS.DAILY_HADITH_UPDATED, id, { method: 'PATCH', path: `/api/v1/daily-hadiths/${id}` });
  return { message: 'Hadith updated', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const hadith = await db.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
  if (!hadith) throw notFound('Hadith not found');

  await db.daily_hadiths.update({ where: { id }, data: { deleted_at: new Date() } });

  writeAudit(c, AUDIT_ACTIONS.DAILY_HADITH_DELETED, id, { method: 'DELETE', path: `/api/v1/daily-hadiths/${id}` });
  return { message: 'Hadith deleted', data: null };
}

export async function findTrash(c: Ctx, query: { page: number; limit: number }, lang: string | null) {
  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);
  const where: Prisma.daily_hadithsWhereInput = { deleted_at: { not: null } };

  const [items, total, active] = await Promise.all([
    db.daily_hadiths.findMany({ where, include: WITH_TRANSLATIONS, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
    db.daily_hadiths.count({ where }),
    loadActiveLanguages(db),
  ]);

  return { message: 'Trash fetched', data: { items: items.map((h) => toAdminItem(h, lang, active)), pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const hadith = await db.daily_hadiths.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!hadith) throw notFound('Deleted hadith not found');

  const restoredAt = new Date();
  let unscheduled = false;
  try {
    await db.daily_hadiths.update({ where: { id }, data: { deleted_at: null, updated_at: restoredAt } });
  } catch (err) {
    // display_date's unique index is partial (live rows only): a P2002 means another hadith took the date
    // while this one sat in the trash. Refusing would strand it (not editable while trashed), so restore
    // it unscheduled instead.
    if (!isUniqueViolation(err) || !hadith.display_date) throw err;
    await db.daily_hadiths.update({ where: { id }, data: { deleted_at: null, display_date: null, updated_at: restoredAt } });
    unscheduled = true;
  }

  const previousDisplayDate = unscheduled && hadith.display_date ? toDateOnly(hadith.display_date) : null;
  if (unscheduled || !hadith.display_date) await releaseEmptyPick(c);

  writeAudit(c, AUDIT_ACTIONS.DAILY_HADITH_RESTORED, id, {
    method: 'POST',
    path: `/api/v1/daily-hadiths/${id}/restore`,
    ...(unscheduled ? { unscheduled: true, previous_display_date: previousDisplayDate } : {}),
  });

  return {
    message: unscheduled ? `Hadith restored without its schedule: ${previousDisplayDate} is now taken by another hadith` : 'Hadith restored',
    data: null,
    meta: { unscheduled, previous_display_date: previousDisplayDate },
  };
}

// ── Internals ──────────────────────────────────────────────────────────

async function formatTodayPick(c: Ctx, hadithId: string | null, lang: string | null, dateOnly: string) {
  const db = getDb(c);
  // By id, ignoring deleted_at: a locked pick keeps returning that hadith for the rest of the day even if it is trashed.
  const hadith = hadithId ? await db.daily_hadiths.findFirst({ where: { id: hadithId }, include: WITH_TRANSLATIONS }) : null;
  return {
    message: "Today's hadith",
    data: hadith ? formatPick(hadith, lang, await loadActiveLanguages(db)) : null,
    meta: { date: dateOnly, source: (hadith ? 'random' : 'empty') as 'random' | 'empty' },
  };
}

/**
 * Called once a hadith has entered the unscheduled pool: an EMPTY lock for today is dropped so the next
 * `/today` draws again instead of hiding the hadith until midnight. A lock holding a pick is left alone.
 * Best effort: the triggering write is committed, so a failure here must not become an error the editor retries.
 */
async function releaseEmptyPick(c: Ctx) {
  try {
    const today = dateOnlyToDbDate(siteDate(siteTimezone(c.env.SITE_TIMEZONE)));
    await getDb(c).daily_hadith_random_picks.deleteMany({ where: { pick_date: today, hadith_id: null } });
  } catch (err) {
    console.warn(`Could not clear today's empty hadith pick: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writeAudit(c: Ctx, action: AuditAction, resourceId: string, changes: Prisma.InputJsonValue) {
  audit(c, { action, resourceType: 'daily_hadith', resourceId, changes });
}

/** Prisma reads and writes a `@db.Date` column as the UTC midnight of that date. */
function dateOnlyToDbDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toAdminItem(h: HadithRow, lang: string | null, active: ReadonlySet<string>) {
  return { ...h, display_date: h.display_date ? toDateOnly(h.display_date) : null, translation: resolveTranslation(h.daily_hadith_translations, lang, { active }) };
}

/** One entry per language, compared case-insensitively: `ar` and `AR` are the same language to an editor. */
function assertUniqueLanguages(translations: { lang: string }[] | null | undefined): void {
  if (!translations) return;
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const { lang } of translations) {
    const key = lang.toLowerCase();
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
  }
  if (duplicated.size > 0) {
    throw badRequest(`translations lists the same language more than once (${[...duplicated].join(', ')}); send one entry per language`, {
      code: 'DUPLICATE_TRANSLATION_LANG',
    });
  }
}

/**
 * Strict `YYYY-MM-DD` to UTC midnight. `new Date('2026-02-30T00:00:00Z')` is not invalid in V8 (it rolls
 * over to March 2nd), so the parsed value is round-tripped to text and compared.
 */
function parseDateOnly(input: string, field: string): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw badRequest(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || toDateOnly(parsed) !== input) throw badRequest(`${field} is not a valid calendar date`);
  return parsed;
}

function formatPick(hadith: HadithRow, lang: string | null, active: ReadonlySet<string>) {
  const t = resolveTranslation(hadith.daily_hadith_translations, lang, { active });
  if (!t) return null;
  return { id: hadith.id, content: t.content, source: t.source ?? null, lang: t.lang };
}

// resolveTranslation can return null for a hadith whose only translation is in a language retired after
// it was created; a non-null assertion here once crashed the whole page for every visitor.
function toPublicItem(hadith: HadithRow, lang: string | null, active: ReadonlySet<string>) {
  const t = resolveTranslation(hadith.daily_hadith_translations, lang, { active });
  if (!t) return null;
  return { id: hadith.id, display_date: hadith.display_date ? toDateOnly(hadith.display_date) : null, content: t.content, source: t.source ?? null, lang: t.lang };
}
