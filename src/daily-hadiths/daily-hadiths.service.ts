import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS, AuditAction } from '../common/audit/audit.actions';
import { isUniqueViolation, rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { getSiteTimezone, siteDate } from '../common/utils/site-time.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CreateDailyHadithDto, DailyHadithQueryDto, UpdateDailyHadithDto } from './dto/daily-hadith.dto';

/**
 * Hadith-of-the-day, by editorial scheduling rather than rotation.
 *
 * Each hadith carries its own optional `display_date`. An editor sets it
 * deliberately when a hadith is thematically tied to a specific calendar
 * occasion — it is never assigned automatically. "Today's hadith" is a
 * lookup (`WHERE display_date = today`), never a computation over the
 * whole pool, so it cannot drift: adding, removing, or editing hadiths
 * never changes what any date is reported to show.
 *
 * "Today" is the calendar day in the SITE time zone (`SITE_TIMEZONE`,
 * default Asia/Baghdad) — the day the editors are scheduling in — not the
 * UTC day.
 *
 * When nothing is scheduled for today, the API falls back to a hadith
 * drawn uniformly at random from the unscheduled pool. The draw itself
 * (which hadith wins) never sets that hadith's own `display_date` — a
 * hadith is only ever scheduled to a date by deliberate editor action.
 * But the draw's *outcome* for the day is locked in `daily_hadith_
 * random_picks` the first time it's resolved, so every visitor sees the
 * same hadith for the rest of that site day regardless of which server
 * instance or CDN edge serves them. A new calendar day has no lock yet
 * and draws fresh. A schedule added for the day later always wins over
 * an existing lock, unconditionally, on every request.
 *
 * A lock that recorded an EMPTY draw (nothing to draw from at the time) is
 * the one exception to "locked for the day": the moment a hadith enters the
 * unscheduled pool (created, restored, or unscheduled) that empty lock is
 * deleted, so the next `/today` draws again instead of hiding the new hadith
 * until midnight. A lock holding an actual pick is never touched.
 *
 * A hadith already scheduled to some other date is never eligible as a
 * random filler — it's reserved for the occasion it was scheduled for.
 *
 * The public collection endpoint (by date, by range, or the plain list)
 * is a pure read: it returns whatever is actually scheduled and nothing
 * else. Only `/today` can ever produce the random fallback.
 */
@Injectable()
export class DailyHadithsService implements OnModuleInit {
  private readonly logger = new Logger(DailyHadithsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve SITE_TIMEZONE at boot so a bad value is warned about once at startup, not on the first request. */
  onModuleInit() {
    getSiteTimezone();
  }

  // ── Public ─────────────────────────────────────────────────────────────

  async getToday(lang: string | null) {
    const dateOnly = siteDate(new Date());
    const today = dateOnlyToDbDate(dateOnly);

    const scheduled = await this.prisma.daily_hadiths.findFirst({
      where: { deleted_at: null, display_date: today },
      include: WITH_TRANSLATIONS,
    });
    if (scheduled) {
      return {
        message: "Today's hadith",
        data: formatPick(scheduled, lang),
        meta: { date: dateOnly, source: 'scheduled' as const },
      };
    }

    // Nothing scheduled: has today's fallback already been decided?
    const locked = await this.prisma.daily_hadith_random_picks.findUnique({ where: { pick_date: today } });
    if (locked) {
      return this.formatTodayPick(locked.hadith_id, lang, dateOnly);
    }

    // Never resolved before today -- draw once and lock it for everyone.
    const undated = await this.prisma.daily_hadiths.findMany({
      where: { deleted_at: null, display_date: null },
      select: { id: true },
    });
    const hadithId = undated.length > 0 ? undated[Math.floor(Math.random() * undated.length)]!.id : null;

    try {
      await this.prisma.daily_hadith_random_picks.create({ data: { pick_date: today, hadith_id: hadithId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // Another concurrent request locked today's pick between our check
      // and our create -- use whichever hadith actually won, not the one
      // we drew, so every visitor still converges on the same answer.
      const winner = await this.prisma.daily_hadith_random_picks.findUniqueOrThrow({ where: { pick_date: today } });
      return this.formatTodayPick(winner.hadith_id, lang, dateOnly);
    }
    return this.formatTodayPick(hadithId, lang, dateOnly);
  }

  /**
   * The public collection: filter by an exact `date`, a `from`/`to` range,
   * or neither (plain paginated browse of every non-deleted hadith). Never
   * falls back to a random pick — that's `/today`'s job alone.
   */
  async findPublic(query: DailyHadithQueryDto, lang: string | null) {
    if (query.date && (query.from || query.to)) {
      throw new BadRequestException('date cannot be combined with from/to');
    }
    if (Boolean(query.from) !== Boolean(query.to)) {
      throw new BadRequestException('from and to must be provided together');
    }

    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.daily_hadithsWhereInput = {
      deleted_at: null,
      // Only rows with a translation in a currently-active, non-deleted
      // language: `some: {}` alone would count a hadith whose only
      // translation is in a language an admin later retired, and
      // resolveTranslation() (see toPublicItem) can then legitimately
      // return null for it — excluding it here keeps such rows out of
      // both the page and the pagination total in the first place.
      daily_hadith_translations: { some: { languages: { is_active: true, deleted_at: null } } },
    };
    let orderBy: Prisma.daily_hadithsOrderByWithRelationInput[] = [{ created_at: 'desc' }, { id: 'asc' }];

    if (query.date) {
      where.display_date = parseDateOnly(query.date, 'date');
      orderBy = [{ display_date: 'asc' }, { id: 'asc' }];
    } else if (query.from && query.to) {
      const from = parseDateOnly(query.from, 'from');
      const to = parseDateOnly(query.to, 'to');
      if (from.getTime() > to.getTime()) throw new BadRequestException('from must be on or before to');
      where.display_date = { gte: from, lte: to };
      orderBy = [{ display_date: 'asc' }, { id: 'asc' }];
    }

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({ where, include: WITH_TRANSLATIONS, orderBy, skip, take: limit }),
      this.prisma.daily_hadiths.count({ where }),
    ]);

    return {
      message: 'Hadiths fetched',
      data: {
        // toPublicItem can legitimately return null (see its own comment);
        // filter rather than assert, even though the where clause above
        // should already keep such rows out of `items`.
        items: items.map((h) => toPublicItem(h, lang)).filter((item) => item !== null),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  // ── Admin (CMS) ────────────────────────────────────────────────────────

  async findAll(query: PaginationDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.daily_hadithsWhereInput = { deleted_at: null };

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({
        where,
        include: WITH_TRANSLATIONS,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.daily_hadiths.count({ where }),
    ]);

    return {
      message: 'Hadiths fetched',
      data: {
        items: items.map((h) => ({
          ...h,
          display_date: h.display_date ? toDateOnly(h.display_date) : null,
          translation: resolveTranslation(h.daily_hadith_translations, lang),
        })),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async findOne(id: string, lang: string | null) {
    const hadith = await this.prisma.daily_hadiths.findFirst({
      where: { id, deleted_at: null },
      include: WITH_TRANSLATIONS,
    });
    if (!hadith) throw new NotFoundException('Hadith not found');
    return {
      message: 'Hadith fetched',
      data: {
        ...hadith,
        display_date: hadith.display_date ? toDateOnly(hadith.display_date) : null,
        translation: resolveTranslation(hadith.daily_hadith_translations, lang),
      },
    };
  }

  async create(dto: CreateDailyHadithDto, userId: string) {
    assertUniqueLanguages(dto.translations);
    const displayDate = dto.display_date ? parseDateOnly(dto.display_date, 'display_date') : null;

    let hadith;
    try {
      hadith = await this.prisma.$transaction(async (tx) => {
        const created = await tx.daily_hadiths.create({ data: { display_date: displayDate } });
        await tx.daily_hadith_translations.createMany({
          data: dto.translations.map((t) => ({
            hadith_id: created.id,
            lang: t.lang,
            content: t.content,
            source: t.source ?? null,
          })),
        });
        return created;
      });
    } catch (err) {
      rethrowP2002AsConflict(err, 'Another hadith is already scheduled to that date');
    }

    if (displayDate === null) await this.releaseEmptyPick();

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_CREATED, hadith.id, {
      method: 'POST',
      path: '/api/v1/daily-hadiths',
    });

    return { message: 'Hadith created', data: hadith };
  }

  async update(id: string, dto: UpdateDailyHadithDto, userId: string) {
    assertUniqueLanguages(dto.translations);
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
    if (!hadith) throw new NotFoundException('Hadith not found');

    try {
      await this.prisma.$transaction(async (tx) => {
        const data: Prisma.daily_hadithsUpdateInput = { updated_at: new Date() };
        if (dto.display_date !== undefined) {
          data.display_date = dto.display_date === null ? null : parseDateOnly(dto.display_date, 'display_date');
        }
        await tx.daily_hadiths.update({ where: { id }, data });

        if (dto.translations) {
          for (const t of dto.translations) {
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

    // Unscheduled after this write (newly unscheduled, or it already was) means
    // it is in the pool the random fallback draws from.
    const unscheduled = dto.display_date === undefined ? hadith.display_date === null : dto.display_date === null;
    if (unscheduled) await this.releaseEmptyPick();

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_UPDATED, id, {
      method: 'PATCH',
      path: `/api/v1/daily-hadiths/${id}`,
    });

    return { message: 'Hadith updated', data: null };
  }

  async softDelete(id: string, userId: string) {
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
    if (!hadith) throw new NotFoundException('Hadith not found');

    await this.prisma.daily_hadiths.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_DELETED, id, {
      method: 'DELETE',
      path: `/api/v1/daily-hadiths/${id}`,
    });

    return { message: 'Hadith deleted', data: null };
  }

  async findTrash(query: PaginationDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.daily_hadithsWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({
        where,
        include: WITH_TRANSLATIONS,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.daily_hadiths.count({ where }),
    ]);

    return {
      message: 'Trash fetched',
      data: {
        items: items.map((h) => ({
          ...h,
          display_date: h.display_date ? toDateOnly(h.display_date) : null,
          translation: resolveTranslation(h.daily_hadith_translations, lang),
        })),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async restore(id: string, userId: string) {
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!hadith) throw new NotFoundException('Deleted hadith not found');

    const restoredAt = new Date();
    let unscheduled = false;
    try {
      await this.prisma.daily_hadiths.update({
        where: { id },
        data: { deleted_at: null, updated_at: restoredAt },
      });
    } catch (err) {
      // display_date carries the only unique index besides the PK (partial:
      // live rows only, migration 20260906120000), so a P2002 here means
      // another hadith claimed this date while this one sat in the trash.
      // Refusing would strand it: it is not editable while trashed, so the
      // date could never be cleared. Restore it unscheduled instead.
      if (!isUniqueViolation(err) || !hadith.display_date) throw err;
      await this.prisma.daily_hadiths.update({
        where: { id },
        data: { deleted_at: null, display_date: null, updated_at: restoredAt },
      });
      unscheduled = true;
    }

    const previousDisplayDate = unscheduled && hadith.display_date ? toDateOnly(hadith.display_date) : null;
    if (unscheduled || !hadith.display_date) await this.releaseEmptyPick();

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_RESTORED, id, {
      method: 'POST',
      path: `/api/v1/daily-hadiths/${id}/restore`,
      ...(unscheduled ? { unscheduled: true, previous_display_date: previousDisplayDate } : {}),
    });

    return {
      message: unscheduled
        ? `Hadith restored without its schedule: ${previousDisplayDate} is now taken by another hadith`
        : 'Hadith restored',
      data: null,
      meta: { unscheduled, previous_display_date: previousDisplayDate },
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async formatTodayPick(hadithId: string | null, lang: string | null, dateOnly: string) {
    const hadith = hadithId ? await this.fetchHadithById(hadithId) : null;
    const source: 'random' | 'empty' = hadith ? 'random' : 'empty';
    return {
      message: "Today's hadith",
      data: hadith ? formatPick(hadith, lang) : null,
      meta: { date: dateOnly, source },
    };
  }

  /**
   * Called once a hadith has just entered the unscheduled pool. If today's
   * lock recorded an EMPTY draw, drop it so the next `/today` draws again --
   * otherwise the hadith would stay invisible until site midnight. A lock
   * holding an actual pick is left alone (the same hadith all day, by design).
   *
   * Best effort: the write that triggered this is already committed, so a
   * failure here must not turn it into an error the editor would retry (and
   * duplicate). The empty lock then simply expires at midnight as before.
   */
  private async releaseEmptyPick() {
    try {
      await this.prisma.daily_hadith_random_picks.deleteMany({
        where: { pick_date: dateOnlyToDbDate(siteDate(new Date())), hadith_id: null },
      });
    } catch (err) {
      this.logger.warn(`Could not clear today's empty hadith pick: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Fetch a hadith by id, ignoring deleted_at -- once a day's random pick
   * is locked in, it keeps returning that hadith's content for the rest
   * of the day even if the hadith is later soft-deleted (same precedent
   * display_date lookups already followed before pins were retired).
   * Returns null only if the row is truly gone, which no API path can
   * cause (hard delete isn't exposed).
   */
  private fetchHadithById(id: string) {
    return this.prisma.daily_hadiths.findFirst({ where: { id }, include: WITH_TRANSLATIONS });
  }

  private writeAudit(actorId: string, action: AuditAction, resourceId: string, changes: Prisma.InputJsonValue) {
    return this.audit.write({
      actorId,
      action,
      resourceType: 'daily_hadith',
      resourceId,
      changes,
    });
  }
}

/**
 * Translations are always fetched ordered by lang -- 'ar' < 'en' < 'fa'
 * alphabetically, so resolveTranslation's fallback (translations[0] once
 * an exact-lang match and the now-removed is_default both miss) lands on
 * Arabic deterministically instead of whatever order Postgres happens to
 * return.
 */
const WITH_TRANSLATIONS = { daily_hadith_translations: { orderBy: { lang: 'asc' as const } } };

type TranslationRow = { lang: string; content: string; source: string | null };
type HadithRow = { id: string; daily_hadith_translations: TranslationRow[] };
type HadithRowWithDate = HadithRow & { display_date: Date | null };

/** Prisma reads and writes a `@db.Date` column as the UTC midnight of that date. */
function dateOnlyToDbDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * One entry per language. Translations are unique per (hadith, lang), so a
 * repeat either tripped that constraint (create, surfacing as a bogus "date
 * already scheduled" 409) or silently overwrote the earlier entry (update).
 * Compared case-insensitively: `ar` and `AR` are the same language to an editor.
 */
function assertUniqueLanguages(translations: { lang: string }[] | undefined): void {
  if (!translations) return;
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const { lang } of translations) {
    const key = lang.toLowerCase();
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
  }
  if (duplicated.size > 0) {
    throw new BadRequestException({
      message: `translations lists the same language more than once (${[...duplicated].join(', ')}); send one entry per language`,
      code: 'DUPLICATE_TRANSLATION_LANG',
    });
  }
}

/**
 * Strict `YYYY-MM-DD` -> UTC midnight. Rejects malformed strings and
 * impossible calendar dates: `new Date('2026-02-30T00:00:00Z')` is *not*
 * invalid in V8, it silently rolls over to March 2nd, so the parsed value
 * is round-tripped back to text and compared.
 */
function parseDateOnly(input: string, field: string): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || toDateOnly(parsed) !== input) {
    throw new BadRequestException(`${field} is not a valid calendar date`);
  }
  return parsed;
}

function formatPick(
  hadith: HadithRow,
  lang: string | null,
): { id: string; content: string; source: string | null; lang: string } | null {
  const t = resolveTranslation(hadith.daily_hadith_translations, lang);
  if (!t) return null;
  return { id: hadith.id, content: t.content, source: t.source ?? null, lang: t.lang };
}

function toPublicItem(hadith: HadithRowWithDate, lang: string | null) {
  // resolveTranslation is NOT total for a non-empty translations array once
  // active-language filtering is in play (see translation.util.ts): a hadith
  // whose only translation is in a language retired after it was created can
  // legitimately resolve to null here. The old `!` assertion crashed the
  // whole page's request for every visitor the moment that happened — mirror
  // formatPick's guard above instead of assuming a translation always exists.
  const t = resolveTranslation(hadith.daily_hadith_translations, lang);
  if (!t) return null;
  return {
    id: hadith.id,
    display_date: hadith.display_date ? toDateOnly(hadith.display_date) : null,
    content: t.content,
    source: t.source ?? null,
    lang: t.lang,
  };
}
