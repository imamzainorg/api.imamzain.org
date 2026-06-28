import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { CategoryCrudConfig, TranslatableCategoryService } from '../common/crud/translatable-category.service';

@Injectable()
export class BookCategoriesService extends TranslatableCategoryService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  protected readonly config: CategoryCrudConfig = {
    categoryModel: 'book_categories',
    translationModel: 'book_category_translations',
    resourceType: 'book_category',
    basePath: 'book-categories',
    audit: {
      created: AUDIT_ACTIONS.BOOK_CATEGORY_CREATED,
      updated: AUDIT_ACTIONS.BOOK_CATEGORY_UPDATED,
      deleted: AUDIT_ACTIONS.BOOK_CATEGORY_DELETED,
      restored: AUDIT_ACTIONS.BOOK_CATEGORY_RESTORED,
    },
    countLiveChildren: (id) =>
      this.prisma.books.count({ where: { category_id: id, deleted_at: null } }),
    childConflictMessage: 'Cannot delete a category that contains books',
  };
}
