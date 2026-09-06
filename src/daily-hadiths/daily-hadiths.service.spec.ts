import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DailyHadithsService } from './daily-hadiths.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

// 2026-05-12, arbitrary — no rotation math depends on the date any more,
// this just needs to be a fixed "today" for the today-vs-scheduled tests.
const TODAY = new Date('2026-05-12T15:30:00.000Z');

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

  beforeEach(async () => {
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

    it('plain mode (no filters): paginated, newest first, excludes hadiths with zero translations', async () => {
      prisma.daily_hadiths.findMany.mockResolvedValue([hadith('h1')]);
      prisma.daily_hadiths.count.mockResolvedValue(1);

      await service.findPublic({ page: 2, limit: 5 }, null);

      expect(prisma.daily_hadiths.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null, daily_hadith_translations: { some: {} } },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
          skip: 5,
          take: 5,
        }),
      );
    });
  });

  // ── admin CRUD ─────────────────────────────────────────────────────────

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
  });

  describe('restore', () => {
    it('turns a P2002 (date reclaimed while trashed) into a 409', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', deleted_at: new Date() });
      prisma.daily_hadiths.update.mockRejectedValue(p2002());

      await expect(service.restore('h1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('restores cleanly when nothing conflicts', async () => {
      prisma.daily_hadiths.findFirst.mockResolvedValue({ id: 'h1', deleted_at: new Date() });

      const res = await service.restore('h1', 'user-1');

      expect(res.message).toBe('Hadith restored');
      expect(audit.write).toHaveBeenCalled();
    });
  });
});
