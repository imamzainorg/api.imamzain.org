import { currentUser } from '../../lib/auth';
import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { changePasswordBody, loginBody, logoutBody, refreshBody } from './schemas';
import * as service from './service';

const app = createApp();

defineRoute(app, { method: 'post', path: '/login', summary: 'Log in and receive access + refresh tokens', limit: 10, body: loginBody, status: 200 }, (c, { body }) =>
  service.login(c, body),
);

defineRoute(
  app,
  { method: 'post', path: '/refresh', summary: 'Exchange a refresh token for new access + refresh tokens', limit: 30, body: refreshBody, status: 200 },
  (c, { body }) => service.refresh(c, body.refresh_token),
);

defineRoute(
  app,
  { method: 'post', path: '/logout', summary: 'Revoke the current refresh token (or all tokens if none supplied)', auth: true, body: logoutBody, status: 200 },
  (c, { body }) => service.logout(c, currentUser(c).id, body.refresh_token),
);

defineRoute(app, { method: 'get', path: '/me', summary: 'Get the current user profile with roles and permissions', auth: true }, (c) =>
  service.getMe(c, currentUser(c).id),
);

defineRoute(
  app,
  {
    method: 'patch',
    path: '/me/password',
    summary: "Change the authenticated user's own password — invalidates all sessions",
    auth: true,
    limit: 5,
    body: changePasswordBody,
    status: 200,
  },
  (c, { body }) => service.changePassword(c, currentUser(c).id, body),
);

export const auth = app;
