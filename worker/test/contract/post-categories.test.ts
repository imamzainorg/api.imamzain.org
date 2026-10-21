import { categorySuite } from './support/category-suite';

categorySuite({
  base: 'post-categories',
  idPrefix: 'pc',
  translationKey: 'post_category_translations',
  insertChild: (q, categoryId, slug) => q('INSERT INTO posts (category_id, slug) VALUES ($1, $2)', [categoryId, slug]),
  childConflict: 'Cannot delete a category that contains posts',
});
