import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { codeParams, createLanguageBody, updateLanguageBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List active languages (public)' }, (c) => {
  publicCache(c, 3600, 86400);
  return service.findAll(c, false);
});

defineRoute(app, { method: 'get', path: '/all', summary: 'List all languages including inactive', auth: ['languages:read'] }, (c) =>
  service.findAll(c, true),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a new language', auth: ['languages:create'], body: createLanguageBody }, (c, { body }) =>
  service.create(c, body),
);

defineRoute(
  app,
  { method: 'patch', path: '/:code', summary: 'Update a language', auth: ['languages:update'], params: codeParams, body: updateLanguageBody },
  (c, { params, body }) => service.update(c, params.code, body),
);

defineRoute(app, { method: 'delete', path: '/:code', summary: 'Soft-delete a language', auth: ['languages:delete'], params: codeParams }, (c, { params }) =>
  service.softDelete(c, params.code),
);

export const languages = app;
