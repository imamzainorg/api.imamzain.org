import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { CategoryCrudConfig, TranslatableCategoryService } from '../common/crud/translatable-category.service';

@Injectable()
export class PostCategoriesService extends TranslatableCategoryService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  protected readonly config: CategoryCrudConfig = {
    categoryModel: 'post_categories',
    translationModel: 'post_category_translations',
    resourceType: 'post_category',
    basePath: 'post-categories',
    audit: {
      created: AUDIT_ACTIONS.POST_CATEGORY_CREATED,
      updated: AUDIT_ACTIONS.POST_CATEGORY_UPDATED,
      deleted: AUDIT_ACTIONS.POST_CATEGORY_DELETED,
      restored: AUDIT_ACTIONS.POST_CATEGORY_RESTORED,
    },
    countLiveChildren: (id) =>
      this.prisma.posts.count({ where: { category_id: id, deleted_at: null } }),
    childConflictMessage: 'Cannot delete a category that contains posts',
  };
}
