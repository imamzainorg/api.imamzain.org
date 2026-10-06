import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { createSpeakerBody, idParams, listQuery, speakerQuery, updateSpeakerBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List speakers (public, paginated)', query: speakerQuery }, (c, { query }) => {
  publicCache(c, 60, 300);
  return service.findAll(c, query, c.get('lang'));
});

defineRoute(app, { method: 'get', path: '/trash', summary: 'List soft-deleted speakers', auth: ['audios:delete'], query: listQuery }, (c, { query }) =>
  service.findTrash(c, query.page, query.limit, c.get('lang')),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a speaker', auth: ['audios:create'], body: createSpeakerBody }, (c, { body }) =>
  service.create(c, body.translations, c.get('lang')),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted speaker', auth: ['audios:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a speaker (public)', params: idParams }, (c, { params }) => {
  publicCache(c, 60, 300);
  return service.findOne(c, params.id, c.get('lang'));
});

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update speaker translations', auth: ['audios:update'], params: idParams, body: updateSpeakerBody },
  (c, { params, body }) => service.update(c, params.id, body.translations, c.get('lang')),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a speaker', auth: ['audios:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

export const speakers = app;
