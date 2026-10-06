import { AUDIT_ACTIONS } from '../../lib/audit';
import { categoryRoutes } from '../../lib/translatable-category/routes';

/** src/book-categories: the shared category routes over book_categories. */
export const bookCategories = categoryRoutes({
  model: 'book_categories',
  translationModel: 'book_category_translations',
  resourceType: 'book_category',
  basePath: 'book-categories',
  audit: {
    created: AUDIT_ACTIONS.BOOK_CATEGORY_CREATED,
    updated: AUDIT_ACTIONS.BOOK_CATEGORY_UPDATED,
    deleted: AUDIT_ACTIONS.BOOK_CATEGORY_DELETED,
    restored: AUDIT_ACTIONS.BOOK_CATEGORY_RESTORED,
  },
  countLiveChildren: (db, id) => db.books.count({ where: { category_id: id, deleted_at: null } }),
  childConflictMessage: 'Cannot delete a category that contains books',
});
