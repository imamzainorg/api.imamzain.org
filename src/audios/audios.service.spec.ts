import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AudiosService } from './audios.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { R2Service } from '../storage/r2.service';

const liveSpeaker = {
  id: 'speaker-1',
  deleted_at: null,
  speaker_translations: [
    { lang: 'ar', name: 'الخطيب', is_default: true },
    { lang: 'en', name: 'The Speaker', is_default: false },
  ],
};
const trashedSpeaker = { ...liveSpeaker, deleted_at: new Date('2026-09-01T00:00:00Z') };

const baseAudio = {
  id: 'audio-1',
  speaker_id: 'speaker-1',
  audio_url: 'https://cdn.example.com/audio/a.mp3',
  pdf_url: null,
  slug: 'lecture',
  duration_seconds: 60,
  size_mb: 1.5,
  is_published: true,
  views: 3,
  peaks: [0.1, 0.4],
  audio_translations: [{ lang: 'ar', title: 'محاضرة', is_default: true }],
  speakers: liveSpeaker,
};

describe('AudiosService', () => {
  let service: AudiosService;
  let prisma: any;
  let audit: any;

  const mockTx = {
    audios: { findFirst: jest.fn(), update: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudiosService,
        {
          provide: PrismaService,
          useValue: {
            audios: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn((cb: any) => cb(mockTx)),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
        { provide: R2Service, useValue: {} },
      ],
    }).compile();

    service = module.get(AudiosService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('speaker visibility on public reads (B-Aud1)', () => {
    const list = (rows: any[]) => {
      prisma.audios.findMany.mockResolvedValue(rows);
      prisma.audios.count.mockResolvedValue(rows.length);
    };

    it('serves the speaker of a live speaker, without leaking its deleted_at', async () => {
      list([baseAudio]);

      const { data } = await service.findAllPublic({}, 'ar');

      expect(data.items[0]!.speaker).toMatchObject({ id: 'speaker-1', translation: { name: 'الخطيب' } });
      expect(data.items[0]!.speaker).not.toHaveProperty('deleted_at');
    });

    it('resolves a trashed speaker as null on the public list — the name is never served', async () => {
      list([{ ...baseAudio, speakers: trashedSpeaker }]);

      const { data } = await service.findAllPublic({}, 'ar');

      expect(data.items[0]!.speaker).toBeNull();
      expect(JSON.stringify(data)).not.toContain('الخطيب');
    });

    it('does the same on the public detail by id and by slug', async () => {
      prisma.audios.findFirst.mockResolvedValue({ ...baseAudio, speakers: trashedSpeaker });

      expect((await service.findOne('audio-1', 'ar')).data.speaker).toBeNull();
      expect((await service.findBySlug('lecture', 'ar')).data.speaker).toBeNull();
    });

    it('keeps an audio with no speaker at all working', async () => {
      prisma.audios.findFirst.mockResolvedValue({ ...baseAudio, speaker_id: null, speakers: null });

      expect((await service.findOne('audio-1', 'ar')).data.speaker).toBeNull();
    });

    it('still shows the trashed speaker to the CMS (admin list, admin detail, trash)', async () => {
      list([{ ...baseAudio, speakers: trashedSpeaker }]);
      prisma.audios.findFirst.mockResolvedValue({ ...baseAudio, speakers: trashedSpeaker });

      const adminList = await service.findAllAdmin({}, 'ar');
      const adminOne = await service.findOne('audio-1', 'ar', { allowUnpublished: true });
      const trash = await service.findTrash(1, 20, 'ar');

      for (const speaker of [adminList.data.items[0]!.speaker, adminOne.data.speaker, trash.data.items[0]!.speaker]) {
        expect(speaker).toMatchObject({ id: 'speaker-1', translation: { name: 'الخطيب' } });
        expect(speaker).not.toHaveProperty('deleted_at');
      }
    });

    it('does not let a public ?search= match on a trashed speaker name; the CMS search still does', async () => {
      list([]);

      await service.findAllPublic({ search: 'الخطيب' }, 'ar');
      await service.findAllAdmin({ search: 'الخطيب' }, 'ar');

      const speakerBranch = (call: number) => prisma.audios.findMany.mock.calls[call][0].where.OR[1].speakers;
      expect(speakerBranch(0)).toEqual(expect.objectContaining({ deleted_at: null }));
      expect(speakerBranch(1)).not.toHaveProperty('deleted_at');
    });
  });

  describe('restore', () => {
    const trashed = {
      id: 'audio-1',
      slug: 'lecture__del_1',
      audio_url: 'https://cdn.example.com/audio/a.mp3__del_1',
      speakers: liveSpeaker,
    };

    beforeEach(() => {
      mockTx.audios.findFirst.mockResolvedValue(null); // no slug / url clash
      mockTx.audios.update.mockResolvedValue({});
    });

    it('refuses with 409 AUDIO_SPEAKER_DELETED when the speaker is in the trash, and changes nothing', async () => {
      prisma.audios.findFirst.mockResolvedValue({ ...trashed, speakers: trashedSpeaker });

      const attempt = service.restore('audio-1', 'user-1');

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'AUDIO_SPEAKER_DELETED',
          message: expect.stringContaining('restore the speaker first'),
        }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('reads the speaker state in the same query that finds the audio', async () => {
      prisma.audios.findFirst.mockResolvedValue(trashed);

      await service.restore('audio-1', 'user-1');

      expect(prisma.audios.findFirst.mock.calls[0][0].select.speakers).toEqual({ select: { deleted_at: true } });
    });

    it('restores an audio whose speaker is live', async () => {
      prisma.audios.findFirst.mockResolvedValue(trashed);

      const result = await service.restore('audio-1', 'user-1');

      expect(result.message).toBe('Audio restored');
      expect(mockTx.audios.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'audio-1' }, data: expect.objectContaining({ deleted_at: null, slug: 'lecture' }) }),
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
    });

    it('restores an audio that never had a speaker', async () => {
      prisma.audios.findFirst.mockResolvedValue({ ...trashed, speakers: null });

      await expect(service.restore('audio-1', 'user-1')).resolves.toMatchObject({ message: 'Audio restored' });
    });

    it('still 404s for an audio that is not in the trash', async () => {
      prisma.audios.findFirst.mockResolvedValue(null);

      await expect(service.restore('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('togglePublish', () => {
    it('is a no-op when the audio is already in the requested state (no write, no audit row)', async () => {
      prisma.audios.findFirst.mockResolvedValue({ ...baseAudio, is_published: true });

      const result = await service.togglePublish('audio-1', { is_published: true }, 'user-1', null);

      expect(result.message).toBe('Audio already in requested state');
      expect(prisma.audios.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('flips the flag and writes one audit row when the state changes', async () => {
      prisma.audios.findFirst.mockResolvedValue({ ...baseAudio, is_published: false });

      const result = await service.togglePublish('audio-1', { is_published: true }, 'user-1', null);

      expect(result.message).toBe('Audio published');
      expect(prisma.audios.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'audio-1' }, data: expect.objectContaining({ is_published: true }) }),
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
    });
  });
});
