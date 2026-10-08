import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { currentUser } from '../../lib/auth';
import { assignRoleBody, createUserBody, idParams, listQuery, resetPasswordBody, roleParams, updateUserBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List all admin users (paginated)', auth: ['users:read'], query: listQuery }, (c, { query }) =>
  service.findAll(c, query.page, query.limit),
);

defineRoute(app, { method: 'get', path: '/trash', summary: 'List soft-deleted users (CMS trash view)', auth: ['users:delete'], query: listQuery }, (c, { query }) =>
  service.findTrash(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted user', auth: ['users:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id, currentUser(c)),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a single user with their roles and permissions', auth: ['users:read'], params: idParams }, (c, { params }) =>
  service.findOne(c, params.id),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a new admin user', auth: ['users:create'], body: createUserBody }, (c, { body }) =>
  service.create(c, body),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: "Update a user's username", auth: ['users:update'], params: idParams, body: updateUserBody },
  (c, { params, body }) => service.update(c, params.id, body, currentUser(c)),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a user', auth: ['users:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id, currentUser(c)),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/roles', summary: 'Assign a role to a user', auth: ['users:update'], params: idParams, body: assignRoleBody },
  (c, { params, body }) => service.assignRole(c, params.id, body.role_id, currentUser(c)),
);

defineRoute(
  app,
  { method: 'delete', path: '/:id/roles/:roleId', summary: 'Remove a role from a user', auth: ['users:update'], params: roleParams },
  (c, { params }) => service.removeRole(c, params.id, params.roleId, currentUser(c)),
);

defineRoute(
  app,
  {
    method: 'post',
    path: '/:id/reset-password',
    summary: 'Admin-driven password reset',
    auth: ['users:update'],
    limit: 10,
    params: idParams,
    body: resetPasswordBody,
    status: 200,
  },
  (c, { params, body }) => service.adminResetPassword(c, params.id, body.new_password, currentUser(c)),
);

export const users = app;
