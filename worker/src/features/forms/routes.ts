import { currentUser } from '../../lib/auth';
import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { contestRoutes } from '../contest/routes';
import {
  contactQuery,
  createContactBody,
  createProxyVisitBody,
  idParams,
  proxyVisitQuery,
  updateContactBody,
  updateProxyVisitBody,
} from './schemas';
import * as service from './service';

const app = createApp();

// Public submissions: Nest's 300 / h per IP is above RL_GLOBAL's 200 / min, so the global tier caps it.
defineRoute(app, { method: 'post', path: '/proxy-visit', summary: 'Submit a proxy visit request (public)', limit: 300, body: createProxyVisitBody }, (c, { body }) =>
  service.submitProxyVisit(c, body),
);

defineRoute(
  app,
  { method: 'get', path: '/proxy-visits', summary: 'List proxy visit requests (paginated)', auth: ['forms:read'], query: proxyVisitQuery },
  (c, { query }) => service.findAllProxyVisits(c, query.page, query.limit, query.status),
);

defineRoute(
  app,
  { method: 'patch', path: '/proxy-visits/:id', summary: 'Update a proxy visit request status', auth: ['forms:update'], params: idParams, body: updateProxyVisitBody },
  (c, { params, body }) => service.updateProxyVisit(c, params.id, body, currentUser(c).id),
);

defineRoute(
  app,
  { method: 'delete', path: '/proxy-visits/:id', summary: 'Soft-delete a proxy visit request', auth: ['forms:delete'], params: idParams },
  (c, { params }) => service.softDeleteProxyVisit(c, params.id, currentUser(c).id),
);

defineRoute(
  app,
  { method: 'get', path: '/proxy-visits/trash', summary: 'List soft-deleted proxy visit requests (CMS trash view)', auth: ['forms:delete'], query: proxyVisitQuery },
  (c, { query }) => service.findTrashProxyVisits(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/proxy-visits/:id/restore', summary: 'Restore a soft-deleted proxy visit request', auth: ['forms:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restoreProxyVisit(c, params.id, currentUser(c).id),
);

defineRoute(app, { method: 'post', path: '/contact', summary: 'Submit a contact form (public)', limit: 300, body: createContactBody }, (c, { body }) =>
  service.submitContact(c, body),
);

defineRoute(app, { method: 'get', path: '/contacts', summary: 'List contact submissions (paginated)', auth: ['forms:read'], query: contactQuery }, (c, { query }) =>
  service.findAllContacts(c, query.page, query.limit, query.status),
);

defineRoute(
  app,
  { method: 'patch', path: '/contacts/:id', summary: 'Update a contact submission status', auth: ['forms:update'], params: idParams, body: updateContactBody },
  (c, { params, body }) => service.updateContact(c, params.id, body, currentUser(c).id),
);

defineRoute(
  app,
  { method: 'delete', path: '/contacts/:id', summary: 'Soft-delete a contact submission', auth: ['forms:delete'], params: idParams },
  (c, { params }) => service.softDeleteContact(c, params.id, currentUser(c).id),
);

defineRoute(
  app,
  { method: 'get', path: '/contacts/trash', summary: 'List soft-deleted contact submissions (CMS trash view)', auth: ['forms:delete'], query: contactQuery },
  (c, { query }) => service.findTrashContacts(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/contacts/:id/restore', summary: 'Restore a soft-deleted contact submission', auth: ['forms:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restoreContact(c, params.id, currentUser(c).id),
);

// /api/v1/forms/qutuf-sajjadiya-contest/* (src/contest).
contestRoutes(app);

export const forms = app;
