import { AUDIT_ACTIONS } from '../../lib/audit';
import { categoryRoutes } from '../../lib/translatable-category/routes';

/** src/academic-paper-categories: the shared category routes over academic_paper_categories. */
export const academicPaperCategories = categoryRoutes({
  model: 'academic_paper_categories',
  translationModel: 'academic_paper_category_translations',
  resourceType: 'academic_paper_category',
  basePath: 'academic-paper-categories',
  audit: {
    created: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_CREATED,
    updated: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_UPDATED,
    deleted: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_DELETED,
    restored: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_RESTORED,
  },
  countLiveChildren: (db, id) => db.academic_papers.count({ where: { category_id: id, deleted_at: null } }),
  childConflictMessage: 'Cannot delete a category that contains academic papers',
});
