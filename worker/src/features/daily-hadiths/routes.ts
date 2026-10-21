import type { Context } from 'hono';
import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { publicCacheUntilSiteMidnight } from '../../lib/site-time';
import type { AppEnv } from '../../lib/types';
import { createHadithBody, idParams, listQuery, publicListQuery, setHijriDateBody, updateHadithBody } from './schemas';
import * as service from './service';

const app = createApp();

// A provisional date (the day after a 29th, before sistani.org has been read) is cached for 5 minutes only,
// so the hourly check's answer reaches visitors soon after it lands.
const cacheForHijriDay = (c: Context<AppEnv>, provisional: boolean) =>
  provisional ? publicCacheUntilSiteMidnight(c, 300, 300) : publicCacheUntilSiteMidnight(c, 900, 3600);

defineRoute(app, { method: 'get', path: '/today', summary: "Today's hadith, by sistani.org's Hijri date (public)" }, async (c) => {
  const result = await service.getToday(c, c.get('lang'));
  cacheForHijriDay(c, result.meta.hijri.provisional);
  return result;
});

defineRoute(app, { method: 'get', path: '/hijri-date', summary: "Today's Hijri date (public)" }, async (c) => {
  const result = await service.getHijriDate(c);
  cacheForHijriDay(c, result.data.provisional);
  return result;
});

defineRoute(
  app,
  { method: 'put', path: '/hijri-date', summary: "Set today's Hijri date by hand", auth: ['daily-hadiths:update'], body: setHijriDateBody },
  (c, { body }) => service.setHijriDate(c, body),
);

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
