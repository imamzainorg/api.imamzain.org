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
  let audit: any;

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
            academic_papers: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
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
    audit = module.get(AuditService);
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

  describe('staff-id exposure (uploaded_by)', () => {
    beforeEach(() => {
      prisma.academic_papers.findMany.mockResolvedValue([basePaper]);
      prisma.academic_papers.count.mockResolvedValue(1);
      prisma.academic_papers.findFirst.mockResolvedValue(basePaper);
    });

    it('does not select uploaded_by on the public list, but keeps the rest of the row', async () => {
      await service.findAll({}, 'ar');

      const { select } = prisma.academic_papers.findMany.mock.calls[0][0];
      expect(select.uploaded_by).toBeUndefined();
      expect(select).toMatchObject({ id: true, category_id: true, pdf_url: true, views: true, is_published: true });
    });

    it('keeps uploaded_by on the admin list and the trash view', async () => {
      await service.findAll({}, 'ar', true);
      await service.findTrash(1, 20);

      expect(prisma.academic_papers.findMany.mock.calls[0][0].select.uploaded_by).toBe(true);
      expect(prisma.academic_papers.findMany.mock.calls[1][0].select.uploaded_by).toBe(true);
    });

    it('reads the public detail through an allow-list without uploaded_by', async () => {
      await service.findOne('paper-1', 'ar');

      const args = prisma.academic_papers.findFirst.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select.uploaded_by).toBeUndefined();
      // translations and the category still ride along.
      expect(args.select.academic_paper_translations).toBe(true);
      expect(args.select.academic_paper_categories).toEqual({ include: { academic_paper_category_translations: true } });
    });

    it('keeps the full row (uploaded_by included) on the admin detail', async () => {
      await service.findOne('paper-1', 'ar', true);

      const args = prisma.academic_papers.findFirst.mock.calls[0][0];
      expect(args.select).toBeUndefined();
      expect(args.include).toBeDefined();
    });

    it('resolves the translation from the rows it got, public or admin', async () => {
      const result = await service.findOne('paper-1', 'ar');

      expect(result.data.translation).toMatchObject({ lang: 'ar', title: 'بحث' });
    });
  });

  describe('togglePublish', () => {
    it('is a no-op when the paper is already in the requested state (no write, no audit row)', async () => {
      prisma.academic_papers.findFirst.mockResolvedValue({ ...basePaper, is_published: true });

      const result = await service.togglePublish('paper-1', true, 'user-1', null);

      expect(result.message).toBe('Paper already in requested state');
      expect(prisma.academic_papers.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('flips the flag and writes one audit row when the state changes', async () => {
      prisma.academic_papers.findFirst.mockResolvedValue({ ...basePaper, is_published: false });

      const result = await service.togglePublish('paper-1', true, 'user-1', null);

      expect(result.message).toBe('Paper published');
      expect(prisma.academic_papers.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'paper-1' }, data: expect.objectContaining({ is_published: true }) }),
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
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

    it('returns the created row even when it is a draft (hydrates with the admin flag)', async () => {
      mockTx.academic_papers.create.mockResolvedValue({ ...basePaper, is_published: false });
      // A public-only hydrate (`is_published: true` in the where) finds nothing —
      // which used to turn a committed create into a 404.
      prisma.academic_papers.findFirst.mockImplementation(async (args: any) =>
        args?.where?.is_published === true ? null : { ...basePaper, is_published: false },
      );

      const result = await service.create({ category_id: 'cat-1', translations }, 'user-1', null);

      expect(result.data.id).toBe(basePaper.id);
      const calls = prisma.academic_papers.findFirst.mock.calls;
      expect(calls[calls.length - 1][0].where.is_published).toBeUndefined();
    });

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
