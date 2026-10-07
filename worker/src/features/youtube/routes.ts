import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { listQuery, playlistParams, playlistVideosQuery } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(
  app,
  {
    method: 'get',
    path: '/videos',
    summary: 'List YouTube videos (public, paginated)',
    query: listQuery,
  },
  (c, { query }) => {
    publicCache(c, 900, 3600);
    return service.findVideos(c, query);
  },
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/playlists',
    summary: 'List YouTube playlists (public, paginated)',
    query: listQuery,
  },
  (c, { query }) => {
    publicCache(c, 900, 3600);
    return service.findPlaylists(c, query);
  },
);

defineRoute(
  app,
  {
    method: 'get',
    path: '/playlists/:playlistId/videos',
    summary: 'List videos in a YouTube playlist (public)',
    params: playlistParams,
    query: playlistVideosQuery,
  },
  (c, { params, query }) => {
    publicCache(c, 900, 3600);
    return service.findPlaylistVideos(c, params.playlistId, query.limit);
  },
);

export const youtube = app;
