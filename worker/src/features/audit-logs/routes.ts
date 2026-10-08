import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { auditLogQuery, idParams } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'get', path: '/', summary: 'List audit logs (paginated)', auth: ['audit-logs:read'], query: auditLogQuery }, (c, { query }) =>
  service.findAll(c, query),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a single audit log entry by ID', auth: ['audit-logs:read'], params: idParams }, (c, { params }) =>
  service.findOne(c, params.id),
);

export const auditLogs = app;
