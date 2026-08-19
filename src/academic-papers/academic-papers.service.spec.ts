import { Test, TestingModule } from '@nestjs/testing';
import { AcademicPapersService } from './academic-papers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { R2Service } from '../storage/r2.service';

// Minimal spec — this module had no test coverage before the PDF-upload
// endpoint was added; retrofitting full coverage is a separate task.
describe('AcademicPapersService', () => {
  let service: AcademicPapersService;
  let r2: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcademicPapersService,
        { provide: PrismaService, useValue: {} },
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
});
