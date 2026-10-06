import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { createGalleryBody, galleryQuery, idParams, listQuery, togglePublishBody, updateGalleryBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List gallery images (public)', query: galleryQuery }, (c, { query }) => {
  publicCache(c, 60);
  return service.findAll(c, query, c.get('lang'));
});

defineRoute(
  app,
  { method: 'get', path: '/admin', summary: 'List all gallery images including unpublished (admin)', auth: ['gallery:read'], query: galleryQuery },
  (c, { query }) => service.findAll(c, query, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/admin/:id', summary: 'Get a gallery image including unpublished (admin)', auth: ['gallery:read'], params: idParams },
  (c, { params }) => service.findOne(c, params.id, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/trash', summary: 'List soft-deleted gallery images', auth: ['gallery:delete'], query: listQuery },
  (c, { query }) => service.findTrash(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted gallery image', auth: ['gallery:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a gallery image by media ID (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 60);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/:id/view', summary: 'Record a view for a gallery image (public)', params: idParams, limit: 30 },
  (c, { params }) => service.trackView(c, params.id),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Add an image to the gallery', auth: ['gallery:create'], body: createGalleryBody }, (c, { body }) =>
  service.create(c, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update a gallery image and upsert translations', auth: ['gallery:update'], params: idParams, body: updateGalleryBody },
  (c, { params, body }) => service.update(c, params.id, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id/publish', summary: 'Publish or unpublish a gallery image', auth: ['gallery:update'], params: idParams, body: togglePublishBody },
  (c, { params, body }) => service.togglePublish(c, params.id, body.is_published, c.get('lang')),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a gallery image', auth: ['gallery:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

export const gallery = app;
