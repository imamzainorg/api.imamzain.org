import { createHash, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';

/** The mobile app sends its key in this header; the website never does. */
export const APP_KEY_HEADER = 'x-app-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Sets `isApp`: true only when the request carries `X-App-Key` equal to the APP_CLIENT_KEY secret.
 *
 * This tells the app apart from the website so a book's PDF link can be withheld from the site
 * (books.pdf_access = 'app'). It is a soft gate: the key ships inside the app, so anyone who extracts it
 * is the app. No key configured means nobody is the app. The compare is constant-time (equal-length digests).
 */
export const appClient = createMiddleware<AppEnv>(async (c, next) => {
  const expected = c.env.APP_CLIENT_KEY;
  const sent = c.req.header(APP_KEY_HEADER);
  c.set('isApp', Boolean(expected && sent && timingSafeEqual(digest(sent), digest(expected))));
  await next();
});
