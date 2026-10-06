import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { adminListQuery, createStaticPageBody, idParams, listQuery, slugParams, togglePublishBody, updateStaticPageBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List published static pages (public, paginated)', query: listQuery }, (c, { query }) => {
  publicCache(c, 300, 1800);
  return service.findAllPublic(c, query.page, query.limit);
});

defineRoute(
  app,
  { method: 'get', path: '/admin', summary: 'List static pages (CMS, includes drafts)', auth: ['static-pages:read'], query: adminListQuery },
  (c, { query }) => service.findAllAdmin(c, query.page, query.limit, query.is_published),
);

defineRoute(
  app,
  { method: 'get', path: '/admin/:id', summary: 'Get a static page by ID (CMS, includes drafts)', auth: ['static-pages:read'], params: idParams },
  (c, { params }) => service.findOne(c, params.id, c.get('lang'), { allowUnpublished: true }),
);

defineRoute(
  app,
  { method: 'get', path: '/trash', summary: 'List soft-deleted static pages', auth: ['static-pages:delete'], query: listQuery },
  (c, { query }) => service.findTrash(c, query.page, query.limit),
);

defineRoute(app, { method: 'get', path: '/by-slug/:slug', summary: 'Get a static page by slug (public)', params: slugParams }, (c, { params }) => {
  publicCache(c, 300, 1800);
  return service.findBySlug(c, params.slug, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted static page', auth: ['static-pages:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(
  app,
  {
    method: 'patch',
    path: '/:id/publish',
    summary: 'Publish or unpublish a static page',
    auth: ['static-pages:update'],
    params: idParams,
    body: togglePublishBody,
  },
  (c, { params, body }) => service.togglePublish(c, params.id, body.is_published),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a static page by ID (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 300, 1800);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'post', path: '/', summary: 'Create a static page with translations', auth: ['static-pages:create'], body: createStaticPageBody },
  (c, { body }) => service.create(c, body),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update a static page', auth: ['static-pages:update'], params: idParams, body: updateStaticPageBody },
  (c, { params, body }) => service.update(c, params.id, body),
);

defineRoute(
  app,
  { method: 'delete', path: '/:id', summary: 'Soft-delete a static page', auth: ['static-pages:delete'], params: idParams },
  (c, { params }) => service.softDelete(c, params.id),
);

export const staticPages = app;
