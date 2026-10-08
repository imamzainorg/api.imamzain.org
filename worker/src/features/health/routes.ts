import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'API health check (public)', limit: 60 }, (c) => service.check(c));

export const health = app;
