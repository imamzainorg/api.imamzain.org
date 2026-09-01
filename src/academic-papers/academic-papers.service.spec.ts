import { Test, TestingModule } from '@nestjs/testing';
import { AcademicPapersService } from './academic-papers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { R2Service } from '../storage/r2.service';

const basePaper = {
  id: 'paper-1',
  category_id: 'cat-1',
  published_year: '2024',
  pdf_url: null,
  document_languages: ['ar'],
  views: 0,
  is_published: true,
  deleted_at: null,
  academic_paper_translations: [{ lang: 'ar', title: 'بحث', is_default: true }],
  academic_paper_categories: { academic_paper_category_translations: [] },
};

// Partial spec — this module had no test coverage before the PDF-upload
// endpoint was added; retrofitting full coverage is a separate task.
describe('AcademicPapersService', () => {
  let service: AcademicPapersService;
  let prisma: any;
  let r2: any;

  const mockTx = {
    academic_papers: { create: jest.fn(), update: jest.fn() },
    academic_paper_translations: {
      createMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcademicPapersService,
        {
          provide: PrismaService,
          useValue: {
            academic_papers: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
            academic_paper_categories: { findFirst: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
        {
          provide: R2Service,
          useValue: {
            presignDocumentUpload: jest.fn().mockResolvedValue({
              uploadUrl: 'https://r2.example.com/signed',
              key: 'academic-papers/pdf/uuid/paper.pdf',
              publicUrl: 'https://cdn.imamzain.org/academic-papers/pdf/uuid/paper.pdf',
              maxBytes: 150 * 1024 * 1024,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AcademicPapersService>(AcademicPapersService);
    prisma = module.get(PrismaService);
    r2 = module.get(R2Service);
  });

  afterEach(() => jest.clearAllMocks());

  describe('requestPdfUploadUrl', () => {
    it('delegates to r2.presignDocumentUpload with the academic-papers PDF prefix and 150 MB cap', async () => {
      const result = await service.requestPdfUploadUrl({ filename: 'paper.pdf' });

      expect(r2.presignDocumentUpload).toHaveBeenCalledWith('paper.pdf', 'academic-papers/pdf/', 150 * 1024 * 1024);
      expect(result.message).toBe('Upload URL generated');
      expect(result.data.publicUrl).toContain('academic-papers/pdf/');
    });
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockTx.academic_papers.create.mockResolvedValue(basePaper);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.academic_papers.findFirst.mockResolvedValue(basePaper);
    });

    const translations = [{ lang: 'ar', title: 'بحث', is_default: true }];

    it('persists document_languages when supplied', async () => {
      await service.create({ category_id: 'cat-1', translations, document_languages: ['fa'] }, 'user-1', null);

      expect(mockTx.academic_papers.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ document_languages: ['fa'] }) }),
      );
    });

    it('defaults document_languages to an empty array when omitted', async () => {
      await service.create({ category_id: 'cat-1', translations }, 'user-1', null);

      expect(mockTx.academic_papers.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ document_languages: [] }) }),
      );
    });
  });
});
