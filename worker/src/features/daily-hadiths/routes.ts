import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { publicCacheUntilSiteMidnight } from '../../lib/site-time';
import { createHadithBody, idParams, listQuery, publicListQuery, updateHadithBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/today', summary: "Today's hadith (public)" }, async (c) => {
  const result = await service.getToday(c, c.get('lang'));
  publicCacheUntilSiteMidnight(c, 900, 3600);
  return result;
});

defineRoute(app, { method: 'get', path: '/', summary: 'Browse hadiths (public)', query: publicListQuery }, (c, { query }) => {
  publicCache(c, 300, 1800);
  return service.findPublic(c, query, c.get('lang'));
});

defineRoute(app, { method: 'get', path: '/admin', summary: 'List hadiths (admin)', auth: ['daily-hadiths:read'], query: listQuery }, (c, { query }) =>
  service.findAll(c, query, c.get('lang')),
);

defineRoute(app, { method: 'get', path: '/admin/:id', summary: 'Get a hadith (admin)', auth: ['daily-hadiths:read'], params: idParams }, (c, { params }) =>
  service.findOne(c, params.id, c.get('lang')),
);

defineRoute(app, { method: 'get', path: '/trash', summary: 'List soft-deleted hadiths', auth: ['daily-hadiths:delete'], query: listQuery }, (c, { query }) =>
  service.findTrash(c, query, c.get('lang')),
);

defineRoute(app, { method: 'post', path: '/', summary: 'Create a hadith', auth: ['daily-hadiths:create'], body: createHadithBody }, (c, { body }) =>
  service.create(c, body),
);

defineRoute(app, { method: 'patch', path: '/:id', summary: 'Update a hadith', auth: ['daily-hadiths:update'], params: idParams, body: updateHadithBody }, (c, { params, body }) =>
  service.update(c, params.id, body),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Soft-delete a hadith', auth: ['daily-hadiths:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id),
);

defineRoute(
  app,
  { method: 'post', path: '/:id/restore', summary: 'Restore a soft-deleted hadith', auth: ['daily-hadiths:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id),
);

export const dailyHadiths = app;
