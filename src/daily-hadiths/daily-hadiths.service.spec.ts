import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DailyHadithsService } from './daily-hadiths.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import * as translationUtil from '../common/utils/translation.util';

// 2026-05-12, arbitrary — no rotation math depends on the date any more,
// this just needs to be a fixed "today" for the today-vs-scheduled tests.
// 18:30 in Baghdad: the site day and the UTC day agree here.
const TODAY = new Date('2026-05-12T15:30:00.000Z');

// Baghdad is UTC+3 (no DST): 21:00Z is site midnight, so 22:00Z on the 12th is
// already the 13th on site while the UTC date is still the 12th.
const SITE_MIDNIGHT = new Date('2026-05-12T21:00:00.000Z');
const JUST_BEFORE_SITE_MIDNIGHT = new Date('2026-05-12T20:59:59.999Z');
const UTC_EVENING_SITE_NEXT_DAY = new Date('2026-05-12T22:00:00.000Z');

const dbDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

const tr = (lang: string, content: string, source: string | null = null) => ({ lang, content, source });

const hadith = (id: string, translations = [tr('ar', `نص ${id}`)], displayDate: Date | null = null) => ({
  id,
  display_date: displayDate,
  daily_hadith_translations: translations,
});

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.0.0',
  });
}

describe('DailyHadithsService', () => {
  let service: DailyHadithsService;
  let prisma: any;
  let audit: any;
  const originalTz = process.env.SITE_TIMEZONE;

  beforeEach(async () => {
    delete process.env.SITE_TIMEZONE; // a developer's own env must not steer the day boundary

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyHadithsService,
        {
          provide: PrismaService,
          useValue: {
            daily_hadiths: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              findUniqueOrThrow: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            daily_hadith_translations: {
              createMany: jest.fn().mockResolvedValue({}),
              upsert: jest.fn().mockResolvedValue({}),
            },
            daily_hadith_random_picks: {
              findUnique: jest.fn().mockResolvedValue(null),
              findUniqueOrThrow: jest.fn(),
              create: jest.fn().mockResolvedValue({}),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            $transaction: jest.fn((fn) => fn(prisma)),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get(DailyHadithsService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
  });

  afterEach(() => {
    if (originalTz === undefined) delete process.env.SITE_TIMEZONE;
    else process.env.SITE_TIMEZONE = originalTz;
    jest.clearAllMocks();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ── getToday ───────────────────────────────────────────────────────────

  describe('getToday', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(TODAY));

    /** Distinguishes the two shapes daily_hadiths.findFirst is called with:
     *  the "is anything scheduled today?" check (where.display_date) vs
     *  fetchHadithById resolving a drawn/locked id (where.id). */
    function mockScheduleCheck(scheduled: ReturnType<typeof hadith> | null) {
      prisma.daily_hadiths.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve('display_date' in where ? scheduled : hadith(where.id, [tr('ar', `نص ${where.id}`)])),
      );
    }

    it('returns the hadith scheduled to today, source=scheduled, and never touches the lock table', async () => {
      mockScheduleCheck(hadith('scheduled-1', [tr('ar', 'مجدول', 'المصدر')], new Date('2026-05-12T00:00:00.000Z')));

      const res = await service.getToday('ar');

      expect(prisma.daily_hadiths.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.daily_hadiths.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null, display_date: new Date('2026-05-12T00:00:00.000Z') } }),
      );
      expect(res).toEqual({
        message: "Today's hadith",
        data: { id: 'scheduled-1', content: 'مجدول', source: 'المصدر', lang: 'ar' },
        meta: { date: '2026-05-12', source: 'scheduled' },
      });
      expect(prisma.daily_hadith_random_picks.findUnique).not.toHaveBeenCalled();
      expect(prisma.daily_hadiths.findMany).not.toHaveBeenCalled();
    });

    it('nothing scheduled, no lock yet: draws randomly and locks the winner for today', async () => {
      mockScheduleCheck(null);
      prisma.daily_hadiths.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // index 1 of 3 -> 'b'

      const res = await service.getToday(null);

      expect(prisma.daily_hadith_random_picks.findUnique).toHaveBeenCalledWith({
        where: { pick_date: new Date('2026-05-12T00:00:00.000Z') },
      });
      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledWith({
        where: { deleted_at: null, display_date: null },
        select: { id: true },
      });
      expect(prisma.daily_hadith_random_picks.create).toHaveBeenCalledWith({
        data: { pick_date: new Date('2026-05-12T00:00:00.000Z'), hadith_id: 'b' },
      });
      expect(res.meta).toEqual({ date: '2026-05-12', source: 'random' });
      expect(res.data?.id).toBe('b');
    });

    it('a second call the same day reads the existing lock instead of drawing again -- same hadith for both callers', async () => {
      mockScheduleCheck(null);
      prisma.daily_hadiths.findMany.mockResolvedValue([{ id: 'winner' }]);
      jest.spyOn(Math, 'random').mockReturnValue(0);
      prisma.daily_hadith_random_picks.findUnique
        .mockResolvedValueOnce(null) // first call: nothing locked yet
        .mockResolvedValueOnce({ pick_date: new Date('2026-05-12T00:00:00.000Z'), hadith_id: 'winner' }); // second call: reads the lock

      const first = await service.getToday(null);
      const second = await service.getToday(null);

      expect(prisma.daily_hadith_random_picks.create).toHaveBeenCalledTimes(1); // never draws twice
      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledTimes(1); // second call never touches the pool
      expect(first.data?.id).toBe('winner');
      expect(second.data?.id).toBe('winner');
    });

    it('a concurrent create race (P2002) returns the actual winner, not the hadith this call drew', async () => {
      mockScheduleCheck(null);
      prisma.daily_hadiths.findMany.mockResolvedValue([{ id: 'lost-the-race' }]);
      jest.spyOn(Math, 'random').mockReturnValue(0);
      prisma.daily_hadith_random_picks.create.mockRejectedValue(p2002());
      prisma.daily_hadith_random_picks.findUniqueOrThrow.mockResolvedValue({
        pick_date: new Date('2026-05-12T00:00:00.000Z'),
        hadith_id: 'actual-winner',
      });

      const res = await service.getToday(null);

      expect(res.data?.id).toBe('actual-winner');
      expect(res.meta.source).toBe('random');
    });

    it('an already-locked empty day (hadith_id null) stays empty without re-checking the pool', async () => {
      mockScheduleCheck(null);
      prisma.daily_hadith_random_picks.findUnique.mockResolvedValue({
        pick_date: new Date('2026-05-12T00:00:00.000Z'),
        hadith_id: null,
      });

      const res = await service.getToday(null);

      expect(res).toEqual({ message: "Today's hadith", data: null, meta: { date: '2026-05-12', source: 'empty' } });
      expect(prisma.daily_hadiths.findMany).not.toHaveBeenCalled();
    });

    it('locks the empty outcome when nothing is scheduled and nothing is undated', async () => {
      mockScheduleCheck(null);
      prisma.daily_hadiths.findMany.mockResolvedValue([]);

      const res = await service.getToday(null);

      expect(prisma.daily_hadith_random_picks.create).toHaveBeenCalledWith({
        data: { pick_date: new Date('2026-05-12T00:00:00.000Z'), hadith_id: null },
      });
      expect(res).toEqual({ message: "Today's hadith", data: null, meta: { date: '2026-05-12', source: 'empty' } });
    });

    it('never draws a hadith that is already scheduled to some other date', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue(null);
      prisma.daily_hadiths.findMany.mockResolvedValue([]);
      await service.getToday(null);

      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ display_date: null }) }),
      );
    });

    it('resolves the requested language and falls back to Arabic via lang-ascending order', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue(
        hadith('h', [tr('ar', 'عربي'), tr('en', 'English')], new Date('2026-05-12T00:00:00.000Z')),
      );
      const withEn = await service.getToday('en');
      expect(withEn.data?.lang).toBe('en');

      prisma.daily_hadiths.findFirst.mockResolvedValue(
        hadith('h', [tr('ar', 'عربي'), tr('en', 'English')], new Date('2026-05-12T00:00:00.000Z')),
      );
      const withFa = await service.getToday('fa');
      expect(withFa.data?.lang).toBe('ar'); // no 'fa' translation, falls back to first by lang-asc order
    });

    it('fetches translations ordered by lang ascending (so ar sorts before en/fa)', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue(
        hadith('h', [tr('ar', 'عربي')], new Date('2026-05-12T00:00:00.000Z')),
      );
      await service.getToday(null);

      expect(prisma.daily_hadiths.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { daily_hadith_translations: { orderBy: { lang: 'asc' } } },
        }),
      );
    });

    // ── site time zone ─────────────────────────────────────────────────

    describe('site time zone (Asia/Baghdad by default)', () => {
      it("is still the previous day one millisecond before Baghdad midnight, and the next day at midnight", async () => {
        mockScheduleCheck(null);

        jest.setSystemTime(JUST_BEFORE_SITE_MIDNIGHT);
        const before = await service.getToday(null);
        expect(before.meta.date).toBe('2026-05-12');

        jest.setSystemTime(SITE_MIDNIGHT);
        const after = await service.getToday(null);
        expect(after.meta.date).toBe('2026-05-13');
      });

      it('looks up the hadith scheduled to the SITE date, so an occasion hadith appears at Baghdad midnight, not 3 hours later', async () => {
        jest.setSystemTime(UTC_EVENING_SITE_NEXT_DAY); // 22:00Z on the 12th = 01:00 on the 13th in Baghdad
        mockScheduleCheck(hadith('occasion', [tr('ar', 'مناسبة')], dbDate('2026-05-13')));

        const res = await service.getToday('ar');

        expect(prisma.daily_hadiths.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { deleted_at: null, display_date: dbDate('2026-05-13') } }),
        );
        expect(res.data?.id).toBe('occasion');
        expect(res.meta).toEqual({ date: '2026-05-13', source: 'scheduled' });
      });

      it("does not keep serving the previous day's hadith after Baghdad midnight (yesterday's date is not looked up)", async () => {
        jest.setSystemTime(UTC_EVENING_SITE_NEXT_DAY);
        prisma.daily_hadiths.findFirst.mockImplementation(({ where }: any) =>
          Promise.resolve(
            'display_date' in where && where.display_date.getTime() === dbDate('2026-05-12').getTime()
              ? hadith('yesterday', [tr('ar', 'أمس')], dbDate('2026-05-12'))
              : null,
          ),
        );

        const res = await service.getToday(null);

        expect(res.data?.id).not.toBe('yesterday');
        expect(res.meta.date).toBe('2026-05-13');
      });

      it('keys the random-pick lock by the SITE date', async () => {
        jest.setSystemTime(UTC_EVENING_SITE_NEXT_DAY);
        mockScheduleCheck(null);
        prisma.daily_hadiths.findMany.mockResolvedValue([{ id: 'a' }]);

        await service.getToday(null);

        expect(prisma.daily_hadith_random_picks.findUnique).toHaveBeenCalledWith({ where: { pick_date: dbDate('2026-05-13') } });
        expect(prisma.daily_hadith_random_picks.create).toHaveBeenCalledWith({
          data: { pick_date: dbDate('2026-05-13'), hadith_id: 'a' },
        });
      });

      it('an existing lock for a given date stays valid: the lock lookup uses the plain date', async () => {
        jest.setSystemTime(UTC_EVENING_SITE_NEXT_DAY);
        mockScheduleCheck(null);
        prisma.daily_hadith_random_picks.findUnique.mockResolvedValue({ pick_date: dbDate('2026-05-13'), hadith_id: 'locked' });

        const res = await service.getToday(null);

        expect(res.data?.id).toBe('locked');
        expect(prisma.daily_hadith_random_picks.create).not.toHaveBeenCalled();
      });

      it('follows SITE_TIMEZONE', async () => {
        process.env.SITE_TIMEZONE = 'UTC';
        jest.setSystemTime(UTC_EVENING_SITE_NEXT_DAY);
        mockScheduleCheck(null);

        const res = await service.getToday(null);

        expect(res.meta.date).toBe('2026-05-12');
      });

      it('an invalid SITE_TIMEZONE falls back to Baghdad instead of failing the request', async () => {
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        process.env.SITE_TIMEZONE = 'Not/AZone';
        jest.setSystemTime(UTC_EVENING_SITE_NEXT_DAY);
        mockScheduleCheck(null);

        const res = await service.getToday(null);

        expect(res.meta.date).toBe('2026-05-13');
      });
    });

    // ── empty lock released when a hadith becomes eligible (B-Had2) ────

    describe('a hadith added after an empty draw', () => {
      /** In-memory stand-in for the lock table + hadith pool, honouring deleteMany's where. */
      function statefulTables(initialLock: { pick_date: Date; hadith_id: string | null } | null = null) {
        const state = { lock: initialLock, pool: [] as { id: string }[] };
        prisma.daily_hadiths.findFirst.mockImplementation(({ where }: any) =>
          Promise.resolve('display_date' in where ? null : hadith(where.id)),
        );
        prisma.daily_hadiths.findMany.mockImplementation(() => Promise.resolve(state.pool));
        prisma.daily_hadith_random_picks.findUnique.mockImplementation(() => Promise.resolve(state.lock));
        prisma.daily_hadith_random_picks.create.mockImplementation(({ data }: any) => {
          state.lock = data;
          return Promise.resolve(data);
        });
        prisma.daily_hadith_random_picks.deleteMany.mockImplementation(({ where }: any) => {
          const hit =
            state.lock !== null &&
            state.lock.hadith_id === where.hadith_id &&
            state.lock.pick_date.getTime() === where.pick_date.getTime();
          if (hit) state.lock = null;
          return Promise.resolve({ count: hit ? 1 : 0 });
        });
        prisma.daily_hadiths.create.mockImplementation(() => {
          state.pool = [{ id: 'new' }];
          return Promise.resolve({ id: 'new', display_date: null });
        });
        return state;
      }

      it('shows up on the very next /today instead of waiting for midnight', async () => {
        statefulTables();
        jest.spyOn(Math, 'random').mockReturnValue(0);

        const first = await service.getToday(null);
        expect(first.meta.source).toBe('empty');
        expect((await service.getToday(null)).meta.source).toBe('empty'); // still locked empty

        await service.create({ translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1');

        const after = await service.getToday(null);
        expect(after.meta.source).toBe('random');
        expect(after.data?.id).toBe('new');
      });

      it('never disturbs a lock that holds an actual pick', async () => {
        const state = statefulTables({ pick_date: dbDate('2026-05-12'), hadith_id: 'already-picked' });

        await service.create({ translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1');

        expect(state.lock).toEqual({ pick_date: dbDate('2026-05-12'), hadith_id: 'already-picked' });
        const res = await service.getToday(null);
        expect(res.data?.id).toBe('already-picked');
        expect(prisma.daily_hadith_random_picks.create).not.toHaveBeenCalled();
      });
    });
  });

  // ── findPublic ─────────────────────────────────────────────────────────

  describe('findPublic', () => {
    it('rejects date combined with from/to', async () => {
      await expect(
        service.findPublic({ date: '2026-05-15', from: '2026-05-01', to: '2026-05-31', page: 1, limit: 20 }, null),
      ).rejects.toThrow(/cannot be combined/);
      expect(prisma.daily_hadiths.findMany).not.toHaveBeenCalled();
    });

    it('rejects from without to and to without from', async () => {
      await expect(service.findPublic({ from: '2026-05-01', page: 1, limit: 20 }, null)).rejects.toThrow(
        /must be provided together/,
      );
      await expect(service.findPublic({ to: '2026-05-31', page: 1, limit: 20 }, null)).rejects.toThrow(
        /must be provided together/,
      );
    });

    it('rejects a malformed or impossible date', async () => {
      await expect(service.findPublic({ date: '2026-5-1', page: 1, limit: 20 }, null)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.findPublic({ date: '2026-02-30', page: 1, limit: 20 }, null)).rejects.toThrow(
        /valid calendar date/,
      );
    });

    it('rejects from after to', async () => {
      await expect(
        service.findPublic({ from: '2026-05-31', to: '2026-05-01', page: 1, limit: 20 }, null),
      ).rejects.toThrow(/on or before/);
    });

    it('date mode: looks up the exact display_date, never falls back to random', async () => {
      prisma.daily_hadiths.findMany.mockResolvedValue([
        hadith('h1', [tr('ar', 'محتوى')], new Date('2026-05-15T00:00:00.000Z')),
      ]);
      prisma.daily_hadiths.count.mockResolvedValue(1);

      const res = await service.findPublic({ date: '2026-05-15', page: 1, limit: 20 }, null);

      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ display_date: new Date('2026-05-15T00:00:00.000Z') }),
        }),
      );
      expect(res.data.items).toEqual([
        { id: 'h1', display_date: '2026-05-15', content: 'محتوى', source: null, lang: 'ar' },
      ]);
    });

    it('date mode with nothing scheduled returns an empty page, not an error', async () => {
      const res = await service.findPublic({ date: '2026-05-15', page: 1, limit: 20 }, null);
      expect(res.data.items).toEqual([]);
      expect(res.data.pagination.total).toBe(0);
    });

    it('range mode: filters by display_date between from and to, ordered by date', async () => {
      prisma.daily_hadiths.findMany.mockResolvedValue([
        hadith('h1', [tr('ar', 'أول')], new Date('2026-05-05T00:00:00.000Z')),
        hadith('h2', [tr('ar', 'ثاني')], new Date('2026-05-20T00:00:00.000Z')),
      ]);
      prisma.daily_hadiths.count.mockResolvedValue(2);

      const res = await service.findPublic({ from: '2026-05-01', to: '2026-05-31', page: 1, limit: 20 }, null);

      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            display_date: { gte: new Date('2026-05-01T00:00:00.000Z'), lte: new Date('2026-05-31T00:00:00.000Z') },
          }),
          orderBy: [{ display_date: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(res.data.items.map((i) => i.id)).toEqual(['h1', 'h2']);
    });

    it('plain mode (no filters): paginated, newest first, excludes hadiths with zero translations, or with only retired-language ones', async () => {
      prisma.daily_hadiths.findMany.mockResolvedValue([hadith('h1')]);
      prisma.daily_hadiths.count.mockResolvedValue(1);

      await service.findPublic({ page: 2, limit: 5 }, null);

      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deleted_at: null,
            daily_hadith_translations: { some: { languages: { is_active: true, deleted_at: null } } },
          },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
          skip: 5,
          take: 5,
        }),
      );
    });

    it('drops a hadith whose only translation resolves to null instead of crashing the whole page', async () => {
      // A row can still slip past the query above (e.g. a language retired
      // between the query and the response being built) — resolveTranslation
      // filtering by active language is the last line of defence.
      prisma.daily_hadiths.findMany.mockResolvedValue([hadith('h1'), hadith('h2')]);
      prisma.daily_hadiths.count.mockResolvedValue(2);
      const spy = jest
        .spyOn(translationUtil, 'resolveTranslation')
        .mockImplementationOnce(() => ({ content: 'kept', source: null, lang: 'ar' }) as never)
        .mockImplementationOnce(() => null as never);

      const res = await service.findPublic({ page: 1, limit: 20 }, null);

      expect(res.data.items).toHaveLength(1);
      expect(res.data.items[0].content).toBe('kept');
      spy.mockRestore();
    });
  });

  // ── admin CRUD ─────────────────────────────────────────────────────────

  /** The pick_date the empty-lock release should target while the clock is at UTC_EVENING_SITE_NEXT_DAY. */
  const EMPTY_LOCK_OF_SITE_DAY = { where: { pick_date: dbDate('2026-05-13'), hadith_id: null } };

  describe('create', () => {
    it('creates without a display_date when omitted', async () => {
      prisma.daily_hadiths.create.mockResolvedValue({ id: 'new-id', display_date: null });

      const res = await service.create({ translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1');

      expect(prisma.daily_hadiths.create).toHaveBeenCalledWith({ data: { display_date: null } });
      expect(prisma.daily_hadith_translations.createMany).toHaveBeenCalledWith({
        data: [{ hadith_id: 'new-id', lang: 'ar', content: 'نص', source: null }],
      });
      expect(res.data.id).toBe('new-id');
      expect(audit.write).toHaveBeenCalled();
    });

    it('rejects a malformed display_date before touching the database', async () => {
      await expect(
        service.create({ display_date: '2026-02-30', translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1'),
      ).rejects.toThrow(/valid calendar date/);
      expect(prisma.daily_hadiths.create).not.toHaveBeenCalled();
    });

    it('turns a P2002 on display_date into a 409', async () => {
      prisma.daily_hadiths.create.mockRejectedValue(p2002());

      await expect(
        service.create(
          { display_date: '2026-05-15', translations: [{ lang: 'ar', content: 'نص' }] } as any,
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    describe('empty-lock release', () => {
      beforeEach(() => jest.useFakeTimers().setSystemTime(UTC_EVENING_SITE_NEXT_DAY));

      it("clears today's EMPTY lock (site day) when an unscheduled hadith is created", async () => {
        prisma.daily_hadiths.create.mockResolvedValue({ id: 'new-id', display_date: null });

        await service.create({ translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.daily_hadith_random_picks.deleteMany).toHaveBeenCalledWith(EMPTY_LOCK_OF_SITE_DAY);
      });

      it('leaves the lock alone when the new hadith is scheduled to a date (it is not in the pool)', async () => {
        prisma.daily_hadiths.create.mockResolvedValue({ id: 'new-id', display_date: dbDate('2026-05-20') });

        await service.create(
          { display_date: '2026-05-20', translations: [{ lang: 'ar', content: 'نص' }] } as any,
          'user-1',
        );

        expect(prisma.daily_hadith_random_picks.deleteMany).not.toHaveBeenCalled();
      });

      it('leaves the lock alone when the create fails', async () => {
        prisma.daily_hadiths.create.mockRejectedValue(p2002());

        await expect(
          service.create({ display_date: '2026-05-15', translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1'),
        ).rejects.toThrow(ConflictException);

        expect(prisma.daily_hadith_random_picks.deleteMany).not.toHaveBeenCalled();
      });

      it('a failing lock cleanup does not turn a committed create into an error', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        prisma.daily_hadiths.create.mockResolvedValue({ id: 'new-id', display_date: null });
        prisma.daily_hadith_random_picks.deleteMany.mockRejectedValue(new Error('db down'));

        const res = await service.create({ translations: [{ lang: 'ar', content: 'نص' }] } as any, 'user-1');

        expect(res.data.id).toBe('new-id');
        expect(audit.write).toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
      });
    });

    describe('duplicate translation languages', () => {
      it('is a 400 with a stable code, not the misleading "already scheduled" 409', async () => {
        const call = service.create(
          {
            display_date: '2026-05-15',
            translations: [
              { lang: 'ar', content: 'أول' },
              { lang: 'ar', content: 'ثاني' },
            ],
          } as any,
          'user-1',
        );

        await expect(call).rejects.toBeInstanceOf(BadRequestException);
        await expect(call).rejects.toMatchObject({
          response: { code: 'DUPLICATE_TRANSLATION_LANG', message: expect.stringContaining('ar') },
        });
        await expect(call).rejects.not.toThrow(/already scheduled/);
        expect(prisma.daily_hadiths.create).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('treats languages case-insensitively', async () => {
        await expect(
          service.create(
            {
              translations: [
                { lang: 'en', content: 'a' },
                { lang: 'EN', content: 'b' },
              ],
            } as any,
            'user-1',
          ),
        ).rejects.toMatchObject({ response: { code: 'DUPLICATE_TRANSLATION_LANG' } });
      });

      it('names every repeated language once', async () => {
        const err = await service
          .create(
            {
              translations: [
                { lang: 'ar', content: '1' },
                { lang: 'en', content: '2' },
                { lang: 'ar', content: '3' },
                { lang: 'en', content: '4' },
                { lang: 'ar', content: '5' },
              ],
            } as any,
            'user-1',
          )
          .catch((e) => e);

        expect(err.getResponse().message).toContain('ar, en');
      });

      it('accepts one entry per language', async () => {
        prisma.daily_hadiths.create.mockResolvedValue({ id: 'new-id', display_date: null });

        await expect(
          service.create(
            {
              translations: [
                { lang: 'ar', content: 'عربي' },
                { lang: 'en', content: 'English' },
                { lang: 'fa', content: 'فارسی' },
              ],
            } as any,
            'user-1',
          ),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('update', () => {
    it('404s when the hadith does not exist', async () => {
      await expect(service.update('missing', {} as any, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('sets display_date to null to unschedule', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1' });

      await service.update('h1', { display_date: null } as any, 'user-1');

      expect(prisma.daily_hadiths.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: expect.objectContaining({ display_date: null }),
      });
    });

    it('leaves display_date untouched when omitted from the DTO', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1' });

      await service.update('h1', { translations: [{ lang: 'ar', content: 'محدث' }] } as any, 'user-1');

      const data = prisma.daily_hadiths.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('display_date');
    });

    it('turns a P2002 on display_date into a 409', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1' });
      prisma.daily_hadiths.update.mockRejectedValue(p2002());

      await expect(service.update('h1', { display_date: '2026-05-15' } as any, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    describe('empty-lock release', () => {
      beforeEach(() => jest.useFakeTimers().setSystemTime(UTC_EVENING_SITE_NEXT_DAY));

      it('clears the empty lock when a scheduled hadith is unscheduled (it joins the pool)', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', display_date: dbDate('2026-06-01') });

        await service.update('h1', { display_date: null } as any, 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).toHaveBeenCalledWith(EMPTY_LOCK_OF_SITE_DAY);
      });

      it('clears it after a translation-only edit of an already-unscheduled hadith (idempotent catch-up)', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', display_date: null });

        await service.update('h1', { translations: [{ lang: 'ar', content: 'محدث' }] } as any, 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).toHaveBeenCalledWith(EMPTY_LOCK_OF_SITE_DAY);
      });

      it('leaves the lock alone when the hadith is scheduled to a date, before or after the edit', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', display_date: null });
        await service.update('h1', { display_date: '2026-06-01' } as any, 'user-1'); // scheduling it takes it OUT of the pool

        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h2', display_date: dbDate('2026-06-01') });
        await service.update('h2', { translations: [{ lang: 'ar', content: 'محدث' }] } as any, 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).not.toHaveBeenCalled();
      });

      it('leaves the lock alone when the update fails', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', display_date: dbDate('2026-06-01') });
        prisma.daily_hadiths.update.mockRejectedValue(p2002());

        await expect(service.update('h1', { display_date: null } as any, 'user-1')).rejects.toThrow(ConflictException);

        expect(prisma.daily_hadith_random_picks.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe('duplicate translation languages', () => {
      it('is a 400 with a stable code instead of a silent last-wins upsert', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', display_date: null });

        const call = service.update(
          'h1',
          {
            translations: [
              { lang: 'en', content: 'first' },
              { lang: 'en', content: 'second' },
            ],
          } as any,
          'user-1',
        );

        await expect(call).rejects.toBeInstanceOf(BadRequestException);
        await expect(call).rejects.toMatchObject({
          response: { code: 'DUPLICATE_TRANSLATION_LANG', message: expect.stringContaining('en') },
        });
        expect(prisma.daily_hadiths.update).not.toHaveBeenCalled();
        expect(prisma.daily_hadith_translations.upsert).not.toHaveBeenCalled();
      });

      it('upserts distinct languages as before', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', display_date: null });

        await service.update(
          'h1',
          {
            translations: [
              { lang: 'ar', content: 'عربي' },
              { lang: 'en', content: 'English' },
            ],
          } as any,
          'user-1',
        );

        expect(prisma.daily_hadith_translations.upsert).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('restore', () => {
    const trashed = (displayDate: Date | null) => ({ id: 'h1', deleted_at: new Date(), display_date: displayDate });

    it('404s when there is no such trashed hadith', async () => {
      await expect(service.restore('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('restores cleanly when nothing conflicts, and says it did not touch the schedule', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(dbDate('2026-05-15')));

      const res = await service.restore('h1', 'user-1');

      expect(res).toEqual({
        message: 'Hadith restored',
        data: null,
        meta: { unscheduled: false, previous_display_date: null },
      });
      expect(prisma.daily_hadiths.update).toHaveBeenCalledTimes(1);
      expect(prisma.daily_hadiths.update.mock.calls[0][0].data).not.toHaveProperty('display_date');
      expect(audit.write).toHaveBeenCalled();
    });

    describe("its date was reused by a live hadith while it sat in the trash", () => {
      beforeEach(() => {
        prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(dbDate('2026-05-15')));
        prisma.daily_hadiths.update.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({});
      });

      it('succeeds and comes back UNSCHEDULED instead of a dead-end 409', async () => {
        const res = await service.restore('h1', 'user-1');

        expect(prisma.daily_hadiths.update).toHaveBeenCalledTimes(2);
        expect(prisma.daily_hadiths.update).toHaveBeenLastCalledWith({
          where: { id: 'h1' },
          data: expect.objectContaining({ deleted_at: null, display_date: null }),
        });
        expect(res.data).toBeNull();
        expect(res.meta).toEqual({ unscheduled: true, previous_display_date: '2026-05-15' });
      });

      it('says so in the message, with the date it lost', async () => {
        const res = await service.restore('h1', 'user-1');

        expect(res.message).toContain('without its schedule');
        expect(res.message).toContain('2026-05-15');
      });

      it('records the cleared date in the audit trail', async () => {
        await service.restore('h1', 'user-1');

        expect(audit.write).toHaveBeenCalledWith(
          expect.objectContaining({
            changes: expect.objectContaining({ unscheduled: true, previous_display_date: '2026-05-15' }),
          }),
        );
      });
    });

    it('does not swallow a P2002 for a hadith that had no date (nothing to clear)', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(null));
      prisma.daily_hadiths.update.mockRejectedValue(p2002());

      await expect(service.restore('h1', 'user-1')).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(prisma.daily_hadiths.update).toHaveBeenCalledTimes(1);
    });

    it('rethrows anything that is not a unique violation', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(dbDate('2026-05-15')));
      prisma.daily_hadiths.update.mockRejectedValue(new Error('db down'));

      await expect(service.restore('h1', 'user-1')).rejects.toThrow('db down');
      expect(prisma.daily_hadiths.update).toHaveBeenCalledTimes(1);
    });

    describe('empty-lock release', () => {
      beforeEach(() => jest.useFakeTimers().setSystemTime(UTC_EVENING_SITE_NEXT_DAY));

      it('clears the empty lock when an unscheduled hadith is restored into the pool', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(null));

        await service.restore('h1', 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).toHaveBeenCalledWith(EMPTY_LOCK_OF_SITE_DAY);
      });

      it('clears it when a restore had to drop a taken date (it lands in the pool)', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(dbDate('2026-05-15')));
        prisma.daily_hadiths.update.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({});

        await service.restore('h1', 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).toHaveBeenCalledWith(EMPTY_LOCK_OF_SITE_DAY);
      });

      it('leaves the lock alone when the hadith keeps its date', async () => {
        prisma.daily_hadiths.findFirst.mockResolvedValue(trashed(dbDate('2026-05-15')));

        await service.restore('h1', 'user-1');

        expect(prisma.daily_hadith_random_picks.deleteMany).not.toHaveBeenCalled();
      });
    });
  });
});
