import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { currentUser } from '../../lib/auth';
import { assignPermissionBody, createRoleBody, idParams, listQuery, permissionParams, updateRoleBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List all roles with translations (paginated)', auth: ['roles:read'], query: listQuery }, (c, { query }) =>
  service.findAll(c, c.get('lang'), query.page, query.limit),
);

defineRoute(
  app,
  { method: 'get', path: '/permissions', summary: 'List all available permissions (paginated)', auth: ['roles:read'], query: listQuery },
  (c, { query }) => service.findAllPermissions(c, c.get('lang'), query.page, query.limit),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a role with its permissions', auth: ['roles:read'], params: idParams }, (c, { params }) =>
  service.findOne(c, params.id, c.get('lang')),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a new role with translations', auth: ['roles:create'], body: createRoleBody }, (c, { body }) =>
  service.create(c, body, c.get('lang')),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update a role name or translations', auth: ['roles:update'], params: idParams, body: updateRoleBody },
  (c, { params, body }) => service.update(c, params.id, body, c.get('lang')),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Permanently delete a role', auth: ['roles:delete'], params: idParams }, (c, { params }) =>
  service.remove(c, params.id),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/permissions', summary: 'Assign a permission to a role', auth: ['roles:update'], params: idParams, body: assignPermissionBody },
  (c, { params, body }) => service.assignPermission(c, params.id, body.permissionId, currentUser(c), c.get('lang')),
);

defineRoute(
  app,
  { method: 'delete', path: '/:id/permissions/:permissionId', summary: 'Remove a permission from a role', auth: ['roles:update'], params: permissionParams },
  (c, { params }) => service.removePermission(c, params.id, params.permissionId, currentUser(c), c.get('lang')),
);

export const roles = app;
