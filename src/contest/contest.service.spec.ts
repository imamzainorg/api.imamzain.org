import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ContestService } from './contest.service';
import { PrismaService } from '../prisma/prisma.service';

const ATTEMPT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const mockQuestions = [
  { id: '1', question: 'Who is the 4th Imam?', option_a: 'Ali', option_b: 'Hassan', option_c: 'Zain', option_d: 'Baqir', correct_answer: 'C' },
  { id: '2', question: 'How many surahs are in the Quran?', option_a: '112', option_b: '113', option_c: '114', option_d: '115', correct_answer: 'C' },
];

describe('ContestService', () => {
  let service: ContestService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContestService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    service = module.get<ContestService>(ContestService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('listQuestions', () => {
    it('returns questions without correct_answer field', async () => {
      const publicQuestions = mockQuestions.map(({ correct_answer, ...q }) => q);
      prisma.$queryRaw.mockResolvedValue(publicQuestions);

      const result = await service.listQuestions();

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).not.toHaveProperty('correct_answer');
    });
  });

  describe('start', () => {
    it('returns attempt_id on success', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: ATTEMPT_ID }]);

      const result = await service.start({ name: 'Ahmad', contact: '+9647001234567', contactType: 'phone' }, '127.0.0.1', 'TestAgent');

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });

    it('works with no contact info provided', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: ATTEMPT_ID }]);

      const result = await service.start({}, '127.0.0.1', 'TestAgent');

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });
  });

  describe('submit', () => {
    const validAttempt = [{ id: ATTEMPT_ID, final_score: null }];

    it('throws NotFoundException when attempt does not exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.submit({ attempt_id: ATTEMPT_ID, answers: [] })).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when attempt already submitted', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: 3 }]);

      await expect(service.submit({ attempt_id: ATTEMPT_ID, answers: [] })).rejects.toThrow(ConflictException);
    });

    it('calculates correct score', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(validAttempt)
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([]);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: '1', answer: 'C' },
          { question_id: '2', answer: 'A' },
        ],
      });

      expect(result.data.final_score).toBe(1);
      expect(result.data.total_questions).toBe(2);
      expect(result.success).toBe(true);
    });

    it('returns 0 when all answers are wrong', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(validAttempt)
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([]);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: '1', answer: 'A' },
          { question_id: '2', answer: 'A' },
        ],
      });

      expect(result.data.final_score).toBe(0);
    });

    it('returns perfect score when all answers are correct', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(validAttempt)
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([]);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: '1', answer: 'C' },
          { question_id: '2', answer: 'C' },
        ],
      });

      expect(result.data.final_score).toBe(2);
    });

    it('ignores answers for unknown question IDs', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(validAttempt)
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([]);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [{ question_id: '999', answer: 'C' }],
      });

      expect(result.data.final_score).toBe(0);
    });
  });
});
