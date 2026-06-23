import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { CategoryCrudConfig, TranslatableCategoryService } from '../common/crud/translatable-category.service';

@Injectable()
export class AcademicPaperCategoriesService extends TranslatableCategoryService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  protected readonly config: CategoryCrudConfig = {
    categoryModel: 'academic_paper_categories',
    translationModel: 'academic_paper_category_translations',
    resourceType: 'academic_paper_category',
    basePath: 'academic-paper-categories',
    audit: {
      created: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_CREATED,
      updated: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_UPDATED,
      deleted: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_DELETED,
      restored: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_RESTORED,
    },
    countLiveChildren: (id) =>
      this.prisma.academic_papers.count({ where: { category_id: id, deleted_at: null } }),
    childConflictMessage: 'Cannot delete a category that contains academic papers',
  };
}
