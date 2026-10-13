import { currentUser } from '../../lib/auth';
import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { confirmBody, idParams, subscribeBody, subscriberQuery, unsubscribeBody } from './schemas';
import * as service from './service';

const app = createApp();

// /campaigns/* is dropped (D2) and not registered, so it falls through to Nest.

defineRoute(app, { method: 'post', path: '/subscribe', summary: 'Ask to subscribe an email address to the newsletter (double opt-in)', limit: 5, body: subscribeBody, status: 200 }, (c, { body }) =>
  service.subscribe(c, body),
);

defineRoute(app, { method: 'post', path: '/confirm', summary: 'Confirm a newsletter subscription (public)', limit: 10, body: confirmBody, status: 200 }, (c, { body }) =>
  service.confirm(c, body),
);

defineRoute(app, { method: 'post', path: '/unsubscribe', summary: 'Unsubscribe an email address (public)', limit: 5, body: unsubscribeBody, status: 200 }, (c, { body }) =>
  service.unsubscribe(c, body),
);

defineRoute(app, { method: 'get', path: '/subscribers', summary: 'List newsletter subscribers (paginated)', auth: ['newsletter:read'], query: subscriberQuery }, (c, { query }) =>
  service.findAll(c, query.page, query.limit, { search: query.search, is_active: query.is_active }),
);

defineRoute(
  app,
  { method: 'post', path: '/subscribers/:id/unsubscribe', summary: 'Unsubscribe a subscriber (admin)', auth: ['newsletter:update'], params: idParams, status: 200 },
  (c, { params }) => service.unsubscribeAsAdmin(c, params.id, currentUser(c).id),
);

defineRoute(
  app,
  { method: 'post', path: '/subscribers/:id/resubscribe', summary: 'Reactivate an inactive subscriber (admin)', auth: ['newsletter:update'], params: idParams, status: 200 },
  (c, { params }) => service.resubscribeAsAdmin(c, params.id, currentUser(c).id),
);

defineRoute(app, { method: 'get', path: '/subscribers/trash', summary: 'List soft-deleted subscribers (CMS trash view)', auth: ['newsletter:delete'], query: subscriberQuery }, (c, { query }) =>
  service.findTrash(c, query.page, query.limit),
);

defineRoute(
  app,
  { method: 'post', path: '/subscribers/:id/restore', summary: 'Restore a soft-deleted subscriber (admin)', auth: ['newsletter:delete'], params: idParams, status: 200 },
  (c, { params }) => service.restore(c, params.id, currentUser(c).id),
);

defineRoute(app, { method: 'delete', path: '/subscribers/:id', summary: 'Soft-delete a subscriber record (admin)', auth: ['newsletter:delete'], params: idParams }, (c, { params }) =>
  service.softDelete(c, params.id, currentUser(c).id),
);

export const newsletter = app;
