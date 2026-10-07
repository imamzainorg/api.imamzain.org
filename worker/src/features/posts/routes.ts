import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { bulkIdsBody, bulkPublishBody, createPostBody, idParams, listQuery, postQuery, slugParams, togglePublishBody, updatePostBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List published posts (public)', query: postQuery }, (c, { query }) => {
  publicCache(c, 60);
  return service.findAll(c, query, c.get('lang'));
});

defineRoute(app, { method: 'get', path: '/by-slug/:slug', summary: 'Get a published post by its slug (public)', params: slugParams }, (c, { params }) => {
  publicCache(c, 60);
  return service.findBySlug(c, params.slug, c.get('lang'));
});

defineRoute(
  app,
  { method: 'get', path: '/admin', summary: 'List all posts including unpublished (admin)', auth: ['posts:read'], query: postQuery },
  (c, { query }) => service.findAll(c, query, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/admin/:id', summary: 'Get a single post by ID including unpublished (admin)', auth: ['posts:read'], params: idParams },
  (c, { params }) => service.findOne(c, params.id, c.get('lang'), true),
);

defineRoute(
  app,
  { method: 'get', path: '/trash', summary: 'List soft-deleted posts (CMS trash view)', auth: ['posts:delete'], query: listQuery },
  (c, { query }) => service.findTrash(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted post', auth: ['posts:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a single published post by ID (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 60);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/:id/view', summary: 'Record a view for a published post (public)', params: idParams, limit: 30 },
  (c, { params }) => service.trackView(c, params.id),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a new post with translations', auth: ['posts:create'], body: createPostBody }, (c, { body }) =>
  service.create(c, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update a post and upsert translations', auth: ['posts:update'], params: idParams, body: updatePostBody },
  (c, { params, body }) => service.update(c, params.id, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id/publish', summary: 'Publish or unpublish a post', auth: ['posts:update'], params: idParams, body: togglePublishBody },
  (c, { params, body }) => service.togglePublish(c, params.id, body.is_published, c.get('lang')),
);

defineRoute(
  app,
  { method: 'post', path: '/bulk/publish', summary: 'Bulk publish / unpublish posts', auth: ['posts:update'], body: bulkPublishBody, status: 200 },
  (c, { body }) => service.bulkSetPublish(c, body.ids, body.is_published),
);

defineRoute(
  app,
  { method: 'post', path: '/bulk/delete', summary: 'Bulk soft-delete posts', auth: ['posts:delete'], body: bulkIdsBody, status: 200 },
  (c, { body }) => service.bulkDelete(c, body.ids),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a post', auth: ['posts:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

export const posts = app;
