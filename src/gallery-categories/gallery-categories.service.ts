import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { CategoryCrudConfig, TranslatableCategoryService } from '../common/crud/translatable-category.service';

@Injectable()
export class GalleryCategoriesService extends TranslatableCategoryService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  protected readonly config: CategoryCrudConfig = {
    categoryModel: 'gallery_categories',
    translationModel: 'gallery_category_translations',
    resourceType: 'gallery_category',
    basePath: 'gallery-categories',
    audit: {
      created: AUDIT_ACTIONS.GALLERY_CATEGORY_CREATED,
      updated: AUDIT_ACTIONS.GALLERY_CATEGORY_UPDATED,
      deleted: AUDIT_ACTIONS.GALLERY_CATEGORY_DELETED,
      restored: AUDIT_ACTIONS.GALLERY_CATEGORY_RESTORED,
    },
    countLiveChildren: (id) =>
      this.prisma.gallery_images.count({ where: { category_id: id, deleted_at: null } }),
    childConflictMessage: 'Cannot delete a category that contains gallery images',
  };
}
