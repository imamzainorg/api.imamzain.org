import { categorySuite } from './support/category-suite';

categorySuite({
  base: 'academic-paper-categories',
  idPrefix: 'ap',
  translationKey: 'academic_paper_category_translations',
  insertChild: (q, categoryId) => q('INSERT INTO academic_papers (category_id) VALUES ($1)', [categoryId]),
  childConflict: 'Cannot delete a category that contains academic papers',
});
