import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { BOOK_PDF_PREFIX, DOCUMENT_PDF_BYTES, presignDocumentUpload } from '../../lib/r2';
import { pdfUploadBody } from '../../lib/upload-url';
import { bookQuery, createBookBody, idParams, listQuery, slugParams, togglePublishBody, updateBookBody } from './schemas';
import * as service from './service';

const app = createApp();

// POST /upload-url has no route here: it needs R2 presigning (media, S25), so it still falls through to Nest.

defineRoute(app, { method: 'get', path: '/', summary: 'List all books (public)', query: bookQuery }, (c, { query }) => {
  publicCache(c, 60);
  return service.findAll(c, query, c.get('lang'));
});

defineRoute(
  app,
  { method: 'get', path: '/admin', summary: 'List all books including unpublished (admin)', auth: ['books:read'], query: bookQuery },
  (c, { query }) => service.findAll(c, query, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/admin/:id', summary: 'Get a single book by ID including unpublished (admin)', auth: ['books:read'], params: idParams },
  (c, { params }) => service.findOne(c, params.id, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/trash', summary: 'List soft-deleted books (CMS trash view)', auth: ['books:delete'], query: listQuery },
  (c, { query }) => service.findTrash(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted book', auth: ['books:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'get', path: '/by-slug/:slug', summary: 'Get a single book by slug (public)', params: slugParams }, (c, { params }) => {
  publicCache(c, 60, 300);
  return service.findBySlug(c, params.slug, c.get('lang'));
});

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a single book by ID (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 60);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/:id/view', summary: 'Record a view for a book (public)', params: idParams, limit: 30 },
  (c, { params }) => service.trackView(c, params.id),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a new book with translations', auth: ['books:create'], body: createBookBody }, (c, { body }) =>
  service.create(c, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update a book and upsert translations', auth: ['books:update'], params: idParams, body: updateBookBody },
  (c, { params, body }) => service.update(c, params.id, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id/publish', summary: 'Publish or unpublish a book', auth: ['books:update'], params: idParams, body: togglePublishBody },
  (c, { params, body }) => service.togglePublish(c, params.id, body.is_published, c.get('lang')),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a book', auth: ['books:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

// No confirm step: the CMS PUTs to R2 and saves `publicUrl` onto pdf_url.
defineRoute(
  app,
  { method: 'post', path: '/upload-url', summary: 'Request a pre-signed R2 upload URL for a book PDF', auth: ['books:create'], limit: 60, body: pdfUploadBody },
  async (c, { body }) => ({ message: 'Upload URL generated', data: await presignDocumentUpload(c.env, body.filename, BOOK_PDF_PREFIX, DOCUMENT_PDF_BYTES) }),
);

export const books = app;
