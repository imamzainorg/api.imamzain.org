import { categorySuite } from './support/category-suite';

categorySuite({
  base: 'gallery-categories',
  idPrefix: 'gl',
  translationKey: 'gallery_category_translations',
  insertChild: async (q, categoryId, slug) => {
    const [media] = await q("INSERT INTO media (filename, url, mime_type, file_size) VALUES ($1, $2, 'image/jpeg', 1) RETURNING id", [slug, `https://example.test/${slug}.jpg`]);
    await q('INSERT INTO gallery_images (media_id, category_id) VALUES ($1, $2)', [media.id, categoryId]);
  },
  childConflict: 'Cannot delete a category that contains gallery images',
});
