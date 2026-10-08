import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/stats', summary: 'Aggregated counts for the CMS home screen', auth: ['dashboard:read'] }, (c) =>
  service.getStats(c),
);

export const dashboard = app;
