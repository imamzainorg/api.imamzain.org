import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { ACADEMIC_PAPER_PDF_PREFIX, DOCUMENT_PDF_BYTES, presignDocumentUpload } from '../../lib/r2';
import { pdfUploadBody } from '../../lib/upload-url';
import { createPaperBody, idParams, listQuery, paperQuery, togglePublishBody, updatePaperBody } from './schemas';
import * as service from './service';

const app = createApp();

// POST /upload-url has no route here: it needs R2 presigning (media, S25), so it still falls through to Nest.

defineRoute(app, { method: 'get', path: '/', summary: 'List academic papers (public)', query: paperQuery }, (c, { query }) => {
  publicCache(c, 60);
  return service.findAll(c, query, c.get('lang'));
});

defineRoute(
  app,
  { method: 'get', path: '/admin', summary: 'List all academic papers including unpublished (admin)', auth: ['academic-papers:read'], query: paperQuery },
  (c, { query }) => service.findAll(c, query, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/admin/:id', summary: 'Get an academic paper including unpublished (admin)', auth: ['academic-papers:read'], params: idParams },
  (c, { params }) => service.findOne(c, params.id, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/trash', summary: 'List soft-deleted academic papers (CMS trash view)', auth: ['academic-papers:delete'], query: listQuery },
  (c, { query }) => service.findTrash(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted academic paper', auth: ['academic-papers:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get an academic paper by ID (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 60);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/:id/view', summary: 'Record a view for an academic paper (public)', params: idParams, limit: 30 },
  (c, { params }) => service.trackView(c, params.id),
);

defineRoute(
  app,
  { method: 'post', path: '/', summary: 'Create an academic paper with translations', auth: ['academic-papers:create'], body: createPaperBody },
  (c, { body }) => service.create(c, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update an academic paper and upsert translations', auth: ['academic-papers:update'], params: idParams, body: updatePaperBody },
  (c, { params, body }) => service.update(c, params.id, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id/publish', summary: 'Publish or unpublish an academic paper', auth: ['academic-papers:update'], params: idParams, body: togglePublishBody },
  (c, { params, body }) => service.togglePublish(c, params.id, body.is_published, c.get('lang')),
);

defineRoute(
  app,
  { method: 'delete', path: '/:id', summary: 'Soft-delete an academic paper', auth: ['academic-papers:delete'], params: idParams },
  (c, { params }) => service.softDelete(c, params.id),
);

// No confirm step: the CMS PUTs to R2 and saves `publicUrl` onto pdf_url.
defineRoute(
  app,
  { method: 'post', path: '/upload-url', summary: 'Request a pre-signed R2 upload URL for a paper PDF', auth: ['academic-papers:create'], limit: 60, body: pdfUploadBody },
  async (c, { body }) => ({
    message: 'Upload URL generated',
    data: await presignDocumentUpload(c.env, body.filename, ACADEMIC_PAPER_PDF_PREFIX, DOCUMENT_PDF_BYTES),
  }),
);

export const academicPapers = app;
