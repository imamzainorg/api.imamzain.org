import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { searchQuery } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(
  app,
  {
    method: 'get',
    path: '/',
    summary: 'Cross-resource search (public)',
    limit: 60,
    query: searchQuery,
  },
  (c, { query }) => {
    publicCache(c, 30, 60);
    return service.search(c, query, c.get('lang'));
  },
);

export const search = app;
