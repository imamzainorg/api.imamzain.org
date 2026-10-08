import { currentUser } from '../../lib/auth';
import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { confirmBody, idParams, mediaQuery, updateMediaBody, uploadUrlBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'post', path: '/upload-url', summary: 'Request a pre-signed R2 upload URL', auth: ['media:create'], limit: 60, body: uploadUrlBody }, (c, { body }) =>
  service.requestUploadUrl(c, body, currentUser(c).id),
);

defineRoute(
  app,
  { method: 'post', path: '/confirm', summary: 'Confirm an upload and register the media record', auth: ['media:create'], limit: 60, body: confirmBody },
  (c, { body }) => service.confirmUpload(c, body, currentUser(c).id),
);

defineRoute(app, { method: 'get', path: '/', summary: 'List all media records (paginated, searchable, filterable)', auth: ['media:read'], query: mediaQuery }, (c, { query }) =>
  service.findAll(c, query),
);

defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a media record with its variants', auth: ['media:read'], params: idParams }, (c, { params }) =>
  service.findOne(c, params.id),
);

defineRoute(
  app,
  { method: 'get', path: '/:id/references', summary: 'List the records that still use a media file', auth: ['media:read'], params: idParams },
  (c, { params }) => service.findReferences(c, params.id),
);

defineRoute(
  app,
  { method: 'patch', path: '/:id', summary: 'Update media filename or alt text', auth: ['media:update'], params: idParams, body: updateMediaBody },
  (c, { params, body }) => service.update(c, params.id, body, currentUser(c).id),
);

defineRoute(
  app,
  {
    method: 'post',
    path: '/:id/regenerate-variants',
    summary: 'Re-run variant generation for an existing media row',
    auth: ['media:update'],
    limit: 10,
    params: idParams,
    status: 200,
  },
  (c, { params }) => service.regenerateVariants(c, params.id, currentUser(c).id),
);

defineRoute(app, { method: 'delete', path: '/:id', summary: 'Delete a media record and remove the file from R2', auth: ['media:delete'], params: idParams }, (c, { params }) =>
  service.remove(c, params.id, currentUser(c).id),
);

export const media = app;
