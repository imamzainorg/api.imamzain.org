import { categorySuite } from './support/category-suite';

categorySuite({
  base: 'book-categories',
  idPrefix: 'bk',
  translationKey: 'book_category_translations',
  insertChild: (q, categoryId, slug) =>
    q(
      'INSERT INTO books (category_id, cover_image_id, slug) VALUES ($1, (SELECT id FROM media ORDER BY created_at LIMIT 1), $2)',
      [categoryId, slug],
    ),
  childConflict: 'Cannot delete a category that contains books',
});
