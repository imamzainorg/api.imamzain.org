import { Test, TestingModule } from '@nestjs/testing';
import { ContestService } from './contest.service';
import { PrismaService } from '../prisma/prisma.service';

const mockQuestions = [
  { id: 1, question: 'Who is the 4th Imam?', option_a: 'Ali', option_b: 'Hassan', option_c: 'Zain', option_d: 'Baqir', correct_answer: 'c' },
  { id: 2, question: 'How many surahs are in the Quran?', option_a: '112', option_b: '113', option_c: '114', option_d: '115', correct_answer: 'c' },
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

  describe('submit', () => {
    it('calculates correct score', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([{ id: 'submission-1' }]);

      const result = await service.submit(
        {
          answers: [
            { question_id: '1', answer: 'c' },
            { question_id: '2', answer: 'a' },
          ],
          name: 'Test User',
          email: 'test@example.com',
        },
        '127.0.0.1',
        'TestAgent',
      );

      expect(result.data.final_score).toBe(1);
      expect(result.data.total_questions).toBe(2);
    });

    it('returns score of 0 when all answers are wrong', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([{ id: 'sub-2' }]);

      const result = await service.submit(
        {
          answers: [
            { question_id: '1', answer: 'a' },
            { question_id: '2', answer: 'a' },
          ],
        },
        '127.0.0.1',
        'agent',
      );

      expect(result.data.final_score).toBe(0);
    });

    it('returns perfect score when all answers are correct', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([{ id: 'sub-3' }]);

      const result = await service.submit(
        {
          answers: [
            { question_id: '1', answer: 'c' },
            { question_id: '2', answer: 'c' },
          ],
        },
        '127.0.0.1',
        'agent',
      );

      expect(result.data.final_score).toBe(2);
      expect(result.data.total_questions).toBe(2);
    });

    it('ignores answers for unknown question IDs', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([{ id: 'sub-4' }]);

      const result = await service.submit(
        {
          answers: [
            { question_id: '999', answer: 'c' },
          ],
        },
        '127.0.0.1',
        'agent',
      );

      expect(result.data.final_score).toBe(0);
    });

    it('returns the submission id from the DB', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(mockQuestions)
        .mockResolvedValueOnce([{ id: 'sub-uuid-123' }]);

      const result = await service.submit({ answers: [] }, '127.0.0.1', 'agent');

      expect(result.data.id).toBe('sub-uuid-123');
    });
  });
});
