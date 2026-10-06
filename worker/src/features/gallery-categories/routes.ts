import { AUDIT_ACTIONS } from '../../lib/audit';
import { categoryRoutes } from '../../lib/translatable-category/routes';

/** src/gallery-categories: the shared category routes over gallery_categories. */
export const galleryCategories = categoryRoutes({
  model: 'gallery_categories',
  translationModel: 'gallery_category_translations',
  resourceType: 'gallery_category',
  basePath: 'gallery-categories',
  audit: {
    created: AUDIT_ACTIONS.GALLERY_CATEGORY_CREATED,
    updated: AUDIT_ACTIONS.GALLERY_CATEGORY_UPDATED,
    deleted: AUDIT_ACTIONS.GALLERY_CATEGORY_DELETED,
    restored: AUDIT_ACTIONS.GALLERY_CATEGORY_RESTORED,
  },
  countLiveChildren: (db, id) => db.gallery_images.count({ where: { category_id: id, deleted_at: null } }),
  childConflictMessage: 'Cannot delete a category that contains gallery images',
});
