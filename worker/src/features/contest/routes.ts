import type { OpenAPIHono } from '@hono/zod-openapi';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import type { AppEnv } from '../../lib/types';
import { attemptsQuery, startBody, submitBody } from './schemas';
import * as service from './service';

const BASE = '/qutuf-sajjadiya-contest';

/**
 * The contest lives under /api/v1/forms, so its routes go on the forms router: a second router on
 * that prefix would run the shared middleware twice.
 *
 * Nest's per-IP limit on /start and /submit is CONTEST_THROTTLE_PER_IP per 15 min (default 60); the
 * bindings are fixed, so it is RL_60 per 60 s here whatever that variable says.
 */
export function contestRoutes(app: OpenAPIHono<AppEnv>) {
  defineRoute(
    app,
    { method: 'get', path: `${BASE}/attempts`, summary: 'List contest attempts with scores (admin)', auth: ['contest:read'], query: attemptsQuery },
    (c, { query }) => service.findAllAttempts(c, query.page, query.limit, query.submitted),
  );

  defineRoute(app, { method: 'get', path: `${BASE}/questions`, summary: 'Retrieve contest questions (public)' }, (c) => {
    publicCache(c, 300, 3600);
    return service.listQuestions(c);
  });

  defineRoute(app, { method: 'post', path: `${BASE}/start`, summary: 'Start a contest attempt (public)', limit: 60, body: startBody }, (c, { body }) =>
    service.start(c, body),
  );

  defineRoute(
    app,
    { method: 'post', path: `${BASE}/submit`, summary: 'Submit contest answers and receive a score (public)', limit: 60, body: submitBody, status: 200 },
    (c, { body }) => service.submit(c, body),
  );
}
