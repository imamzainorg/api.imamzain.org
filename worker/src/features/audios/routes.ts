import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { presignAudioUpload } from '../../lib/r2';
import { audioAdminQuery, audioUploadBody, audioQuery, createAudioBody, idParams, listQuery, slugParams, togglePublishBody, updateAudioBody } from './schemas';
import * as service from './service';

const app = createApp();

// POST /upload-url has no route here: it needs R2 presigning (media, S25), so it still falls through to Nest.

defineRoute(app, { method: 'get', path: '/', summary: 'List published audios (public, paginated)', query: audioQuery }, (c, { query }) => {
  publicCache(c, 60);
  return service.findAllPublic(c, query, c.get('lang'));
});

defineRoute(
  app,
  { method: 'get', path: '/admin', summary: 'List audios (CMS, includes drafts)', auth: ['audios:read'], query: audioAdminQuery },
  (c, { query }) => service.findAllAdmin(c, query, c.get('lang')),
);

defineRoute(
  app,
  { method: 'get', path: '/admin/:id', summary: 'Get an audio by ID (CMS, includes drafts)', auth: ['audios:read'], params: idParams },
  (c, { params }) => service.findOne(c, params.id, c.get('lang'), { allowUnpublished: true }),
);

defineRoute(
  app,
  { method: 'get', path: '/trash', summary: 'List soft-deleted audios (CMS trash view)', auth: ['audios:delete'], query: listQuery },
  (c, { query }) => service.findTrash(c, query.page, query.limit, c.get('lang')),
);

defineRoute(app, { method: 'get', path: '/by-slug/:slug', summary: 'Get an audio by slug (public)', params: slugParams }, (c, { params }) => {
  publicCache(c, 60, 300);
  return service.findBySlug(c, params.slug, c.get('lang'));
});

defineRoute(app, { method: 'post', path: '/', summary: 'Create an audio record', auth: ['audios:create'], body: createAudioBody }, (c, { body }) =>
  service.create(c, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted audio', auth: ['audios:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a published audio by ID (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 60);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/:id/view', summary: 'Record a view for a published audio (public)', params: idParams, limit: 30 },
  (c, { params }) => service.trackView(c, params.id),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update an audio record and upsert translations', auth: ['audios:update'], params: idParams, body: updateAudioBody },
  (c, { params, body }) => service.update(c, params.id, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id/publish', summary: 'Publish or unpublish an audio', auth: ['audios:update'], params: idParams, body: togglePublishBody },
  (c, { params, body }) => service.togglePublish(c, params.id, body.is_published, c.get('lang')),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete an audio', auth: ['audios:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

// No confirm step: the CMS PUTs to R2 and saves `publicUrl` onto the record.
defineRoute(
  app,
  { method: 'post', path: '/upload-url', summary: 'Request a pre-signed R2 upload URL for an audio file or PDF', auth: ['audios:create'], limit: 60, body: audioUploadBody },
  async (c, { body }) => ({ message: 'Upload URL generated', data: await presignAudioUpload(c.env, body.filename, body.content_type) }),
);

export const audios = app;
