import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import {
  playlistIdParams,
  slugParams,
  updateSeriesBody,
  updateVideoBody,
  videoAdminQuery,
  videoIdParams,
  videoQuery,
  videoSettingsBody,
} from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(
  app,
  {
    method: 'get',
    path: '/',
    summary: 'List the site\'s videos (public, paginated; never live broadcasts)',
    query: videoQuery,
  },
  (c, { query }) => {
    publicCache(c, 60, 300);
    return service.findAllPublic(c, query, c.get('lang'));
  },
);

defineRoute(
  app,
  { method: 'get', path: '/series', summary: 'List video series (public)' },
  (c) => {
    publicCache(c, 60, 300);
    return service.findAllSeries(c, c.get('lang'));
  },
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/series/:slug',
    summary: 'Get a video series with its videos in playlist order (public)',
    params: slugParams,
  },
  (c, { params }) => {
    publicCache(c, 60, 300);
    return service.findSeriesBySlug(c, params.slug, c.get('lang'));
  },
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/admin',
    summary: 'List videos with their status (CMS)',
    auth: ['videos:read'],
    query: videoAdminQuery,
  },
  (c, { query }) => service.findAllAdmin(c, query, c.get('lang')),
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/admin/series',
    summary: 'List every video series, hidden ones included (CMS)',
    auth: ['videos:read'],
  },
  (c) => service.findAllSeries(c, c.get('lang'), true),
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/admin/settings',
    summary: 'Get the video settings (CMS)',
    auth: ['videos:read'],
  },
  (c) => service.getSettings(c),
);

defineRoute(
  app,
  {
    method: 'put',
    path: '/admin/settings',
    summary: 'Turn auto-publishing of new uploads on or off (CMS)',
    auth: ['videos:update'],
    body: videoSettingsBody,
  },
  (c, { body }) => service.updateSettings(c, body.auto_publish),
);

defineRoute(
  app,
  {
    method: 'patch',
    path: '/admin/series/:playlistId',
    summary: 'Update a video series: slug, section, hidden, order, speaker (CMS)',
    auth: ['videos:update'],
    params: playlistIdParams,
    body: updateSeriesBody,
  },
  (c, { params, body }) => service.updateSeries(c, params.playlistId, body, c.get('lang')),
);

defineRoute(
  app,
  {
    method: 'patch',
    path: '/admin/:videoId',
    summary: 'Update a video: slug, status, featured, speaker (CMS)',
    auth: ['videos:update'],
    params: videoIdParams,
    body: updateVideoBody,
  },
  (c, { params, body }) => service.updateVideo(c, params.videoId, body, c.get('lang')),
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/:slug',
    summary: 'Get a video by slug (public)',
    params: slugParams,
  },
  (c, { params }) => {
    publicCache(c, 60, 300);
    return service.findBySlug(c, params.slug, c.get('lang'));
  },
);

export const videos = app;
