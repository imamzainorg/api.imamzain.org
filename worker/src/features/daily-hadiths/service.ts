import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS, type AuditAction } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { badRequest, isUniqueViolation, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { HIJRI_MONTHS, hijriOn, type HijriDate, type HijriToday } from '../../lib/hijri';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import { siteDate, siteTimezone } from '../../lib/site-time';
import type { AppEnv } from '../../lib/types';
import { hijriToday, setHijriToday } from './hijri-date';
import type { HadithTranslationInput } from './schemas';

type Ctx = Context<AppEnv>;

// 'ar' < 'en' < 'fa': the fallback in resolveTranslation lands on Arabic deterministically.
const WITH_TRANSLATIONS = { daily_hadith_translations: { orderBy: { lang: 'asc' as const } } };

const TAKEN = 'Another hadith is already scheduled to that date';

type TranslationRow = { lang: string; content: string; source: string | null };
type HadithRow = { id: string; hijri_month: number | null; hijri_day: number | null; daily_hadith_translations: TranslationRow[] };
type HijriFields = { hijri_month?: number | null; hijri_day?: number | null };

// ── Public ─────────────────────────────────────────────────────────────

/** The hadith for today's Hijri date (sistani.org's), or `data: null` when that day has none. */
export async function getToday(c: Ctx, lang: string | null) {
  const db = getDb(c);
  const date = siteDate(siteTimezone(c.env.SITE_TIMEZONE));
  const hijri = await hijriToday(c.env, date);

  const hadith = await db.daily_hadiths.findFirst({
    where: { deleted_at: null, hijri_month: hijri.month, hijri_day: hijri.day },
    include: WITH_TRANSLATIONS,
  });
  const data = hadith ? formatPick(hadith, lang, await loadActiveLanguages(db)) : null;
  return {
    message: "Today's hadith",
    data,
    meta: { date, hijri: hijriMeta(hijri), source: (data ? 'scheduled' : 'empty') as 'scheduled' | 'empty' },
  };
}

export async function getHijriDate(c: Ctx) {
  const date = siteDate(siteTimezone(c.env.SITE_TIMEZONE));
  return { message: 'Hijri date fetched', data: { date, ...hijriMeta(await hijriToday(c.env, date)) } };
}

/** Browse every hadith in Hijri calendar order, or the ones on one Hijri month / day. */
export async function findPublic(c: Ctx, query: { page: number; limit: number; hijri_month?: number; hijri_day?: number }, lang: string | null) {
  if (query.hijri_day !== undefined && query.hijri_month === undefined) throw badRequest('hijri_day requires hijri_month');

  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);
  const where: Prisma.daily_hadithsWhereInput = {
    deleted_at: null,
    // A hadith whose only translation is in a retired language resolves to null; keep it out of the page and the total.
    daily_hadith_translations: { some: { languages: { is_active: true, deleted_at: null } } },
    ...(query.hijri_month !== undefined ? { hijri_month: query.hijri_month } : {}),
    ...(query.hijri_day !== undefined ? { hijri_day: query.hijri_day } : {}),
  };

  const [items, total, active] = await Promise.all([
    db.daily_hadiths.findMany({ where, include: WITH_TRANSLATIONS, orderBy: CALENDAR_ORDER, skip, take: limit }),
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

export async function create(c: Ctx, body: HijriFields & { translations: HadithTranslationInput[] }) {
  const db = getDb(c);
  assertUniqueLanguages(body.translations);
  const hijri = hijriFields(body) ?? { hijri_month: null, hijri_day: null };

  let hadith;
  try {
    hadith = await db.$transaction(async (tx) => {
      const created = await tx.daily_hadiths.create({ data: hijri });
      await tx.daily_hadith_translations.createMany({
        data: body.translations.map((t) => ({ hadith_id: created.id, lang: t.lang, content: t.content, source: t.source ?? null })),
      });
      return created;
    });
  } catch (err) {
    rethrowP2002AsConflict(err, TAKEN);
  }

  writeAudit(c, AUDIT_ACTIONS.DAILY_HADITH_CREATED, hadith.id, { method: 'POST', path: '/api/v1/daily-hadiths' });
  return { message: 'Hadith created', data: hadith };
}

export async function update(c: Ctx, id: string, body: HijriFields & { translations?: HadithTranslationInput[] | null }) {
  const db = getDb(c);
  assertUniqueLanguages(body.translations);
  const hijri = hijriFields(body);
  const hadith = await db.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
  if (!hadith) throw notFound('Hadith not found');

  try {
    await db.$transaction(async (tx) => {
      await tx.daily_hadiths.update({ where: { id }, data: { updated_at: new Date(), ...(hijri ?? {}) } });

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
    rethrowP2002AsConflict(err, TAKEN);
  }

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
    // The Hijri day's unique index is partial (live rows only): a P2002 means another hadith took the day
    // while this one sat in the trash. Refusing would strand it (not editable while trashed), so restore
    // it without a day instead.
    if (!isUniqueViolation(err) || hadith.hijri_month === null) throw err;
    await db.daily_hadiths.update({ where: { id }, data: { deleted_at: null, hijri_month: null, hijri_day: null, updated_at: restoredAt } });
    unscheduled = true;
  }

  const previous = unscheduled ? { hijri_month: hadith.hijri_month, hijri_day: hadith.hijri_day } : { hijri_month: null, hijri_day: null };

  writeAudit(c, AUDIT_ACTIONS.DAILY_HADITH_RESTORED, id, {
    method: 'POST',
    path: `/api/v1/daily-hadiths/${id}/restore`,
    ...(unscheduled ? { unscheduled: true, previous_hijri_month: previous.hijri_month, previous_hijri_day: previous.hijri_day } : {}),
  });

  return {
    message: unscheduled
      ? `Hadith restored without its schedule: ${previous.hijri_day} ${HIJRI_MONTHS[previous.hijri_month! - 1]} is now taken by another hadith`
      : 'Hadith restored',
    data: null,
    meta: { unscheduled, previous_hijri_month: previous.hijri_month, previous_hijri_day: previous.hijri_day },
  };
}

/** Overrides today's Hijri date (the next sistani.org reading after a month's 29th can replace it). */
export async function setHijriDate(c: Ctx, body: HijriDate) {
  const date = siteDate(siteTimezone(c.env.SITE_TIMEZONE));
  const anchor = await setHijriToday(c.env, date, body);
  audit(c, {
    action: AUDIT_ACTIONS.HIJRI_DATE_SET,
    resourceType: 'hijri_date',
    resourceId: date,
    changes: { method: 'PUT', path: '/api/v1/daily-hadiths/hijri-date', year: body.year, month: body.month, day: body.day, month_start: anchor.start },
  });
  return { message: 'Hijri date set', data: { date, ...hijriMeta(hijriOn(anchor, date)!) } };
}

// ── Internals ──────────────────────────────────────────────────────────

const CALENDAR_ORDER: Prisma.daily_hadithsOrderByWithRelationInput[] = [
  { hijri_month: { sort: 'asc', nulls: 'last' } },
  { hijri_day: { sort: 'asc', nulls: 'last' } },
  { created_at: 'desc' },
  { id: 'asc' },
];

function hijriMeta(h: HijriToday) {
  return { year: h.year, month: h.month, day: h.day, month_name: HIJRI_MONTHS[h.month - 1]!, provisional: h.provisional, source: h.source };
}

/** The Hijri day to write, or undefined to leave it alone. Both fields or neither: half a date is no date. */
function hijriFields(body: HijriFields): { hijri_month: number | null; hijri_day: number | null } | undefined {
  if (body.hijri_month === undefined && body.hijri_day === undefined) return undefined;
  const month = body.hijri_month ?? null;
  const day = body.hijri_day ?? null;
  if ((month === null) !== (day === null)) throw badRequest('hijri_month and hijri_day must be provided together');
  return { hijri_month: month, hijri_day: day };
}

function writeAudit(c: Ctx, action: AuditAction, resourceId: string, changes: Prisma.InputJsonValue) {
  audit(c, { action, resourceType: 'daily_hadith', resourceId, changes });
}

function toAdminItem(h: HadithRow, lang: string | null, active: ReadonlySet<string>) {
  return { ...h, translation: resolveTranslation(h.daily_hadith_translations, lang, { active }) };
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
  return { id: hadith.id, hijri_month: hadith.hijri_month, hijri_day: hadith.hijri_day, content: t.content, source: t.source ?? null, lang: t.lang };
}
