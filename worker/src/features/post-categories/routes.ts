import { AUDIT_ACTIONS } from '../../lib/audit';
import { categoryRoutes } from '../../lib/translatable-category/routes';

/** src/post-categories: the shared category routes over post_categories. */
export const postCategories = categoryRoutes({
  model: 'post_categories',
  translationModel: 'post_category_translations',
  resourceType: 'post_category',
  basePath: 'post-categories',
  audit: {
    created: AUDIT_ACTIONS.POST_CATEGORY_CREATED,
    updated: AUDIT_ACTIONS.POST_CATEGORY_UPDATED,
    deleted: AUDIT_ACTIONS.POST_CATEGORY_DELETED,
    restored: AUDIT_ACTIONS.POST_CATEGORY_RESTORED,
  },
  countLiveChildren: (db, id) => db.posts.count({ where: { category_id: id, deleted_at: null } }),
  childConflictMessage: 'Cannot delete a category that contains posts',
});
