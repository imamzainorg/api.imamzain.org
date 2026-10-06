import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { keyParams, upsertSettingBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/public', summary: 'List public site settings (no auth)' }, (c) => {
  publicCache(c, 900, 3600);
  return service.findPublic(c);
});

defineRoute(app, { method: 'get', path: '/', summary: 'List all settings', auth: ['settings:read'] }, (c) => service.findAll(c));

defineRoute(app, { method: 'get', path: '/:key', summary: 'Get a setting', auth: ['settings:read'], params: keyParams }, (c, { params }) =>
  service.findOne(c, params.key),
);

defineRoute(
  app,
  { method: 'put', path: '/:key', summary: 'Create or update a setting', auth: ['settings:update'], params: keyParams, body: upsertSettingBody, status: 200 },
  (c, { params, body }) => service.upsert(c, params.key, body),
);

defineRoute(app, { method: 'delete', path: '/:key', summary: 'Delete a setting', auth: ['settings:delete'], params: keyParams }, (c, { params }) =>
  service.remove(c, params.key),
);

export const settings = app;
