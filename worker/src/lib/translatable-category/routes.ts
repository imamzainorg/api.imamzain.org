import { createApp } from '../create-app';
import { defineRoute } from '../define-route';
import { publicCache } from '../envelope';
import { createCategoryBody, idParams, listQuery, updateCategoryBody } from './schemas';
import * as service from './service';
import type { CategoryConfig } from './service';

/**
 * The seven routes every *-categories controller has, mounted at `/api/v1/<basePath>`. `/trash` is
 * declared before `/:id`, as in the Nest controllers.
 */
export function categoryRoutes(cfg: CategoryConfig) {
  const app = createApp();
  const can = (action: 'create' | 'update' | 'delete') => [`${cfg.basePath}:${action}`];

  defineRoute(app, { method: 'get', path: '/', summary: 'List categories (public)', query: listQuery }, (c, { query }) => {
    publicCache(c, 300, 1800);
    return service.findAll(c, cfg, query.page, query.limit);
  });

  defineRoute(app, { method: 'get', path: '/trash', summary: 'List soft-deleted categories', auth: can('delete'), query: listQuery }, (c, { query }) =>
    service.findTrash(c, cfg, query.page, query.limit),
  );

  defineRoute(
    app,
    { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted category', auth: can('delete'), params: idParams, status: 200 },
    (c, { params }) => service.restore(c, cfg, params.id),
  );

  defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a category (public)', params: idParams }, (c, { params }) => {
    publicCache(c, 300, 1800);
    return service.findOne(c, cfg, params.id, c.get('lang'));
  });

  defineRoute(app, { method: 'post', path: '/', summary: 'Create a category', auth: can('create'), body: createCategoryBody }, (c, { body }) =>
    service.create(c, cfg, body.translations),
  );

  defineRoute(
    app,
    { method: 'patch', path: '/:id', summary: 'Update category translations', auth: can('update'), params: idParams, body: updateCategoryBody },
    (c, { params, body }) => service.update(c, cfg, params.id, body.translations),
  );

  defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a category', auth: can('delete'), params: idParams }, (c, { params }) =>
    service.softDelete(c, cfg, params.id),
  );

  return app;
}
