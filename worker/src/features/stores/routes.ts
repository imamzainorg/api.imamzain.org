import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { createStoreBody, createStoreLocationSchema, idParams, listQuery, locationParams, updateStoreBody, updateStoreLocationBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List stores with their sale-points (public)', query: listQuery }, (c, { query }) => {
  publicCache(c, 300, 1800);
  return service.findAllPublic(c, c.get('lang'), query.page, query.limit);
});

defineRoute(app, { method: 'get', path: '/trash', summary: 'List soft-deleted stores', auth: ['stores:delete'], query: listQuery }, (c, { query }) =>
  service.findTrash(c, query.page, query.limit),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a store (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 300, 1800);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(app, { method: 'post', path: '/', summary: 'Create a store', auth: ['stores:create'], body: createStoreBody }, (c, { body }) =>
  service.create(c, body),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update a store', auth: ['stores:update'], params: idParams, body: updateStoreBody },
  (c, { params, body }) => service.update(c, params.id, body),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted store', auth: ['stores:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a store', auth: ['stores:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/locations', summary: 'Add a sale-point', auth: ['stores:update'], params: idParams, body: createStoreLocationSchema },
  (c, { params, body }) => service.addLocation(c, params.id, body),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id/locations/:locationId', summary: 'Update a sale-point', auth: ['stores:update'], params: locationParams, body: updateStoreLocationBody },
  (c, { params, body }) => service.updateLocation(c, params.id, params.locationId, body),
);

defineRoute(
  app,
  { method: 'delete', path: '/:id/locations/:locationId', summary: 'Delete a sale-point', auth: ['stores:delete'], params: locationParams },
  (c, { params }) => service.removeLocation(c, params.id, params.locationId),
);

export const stores = app;
