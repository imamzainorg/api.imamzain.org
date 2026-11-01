import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';

/**
 * The User-Agent the mobile app sends on every request (a compile-time constant in the app, `kBrowserUserAgent`).
 * It has no device model, so no real browser sends it. If the app's string ever changes, add the new one here
 * and keep the old one while the old version is still installed.
 */
export const APP_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

/**
 * Sets `isApp`: true when the request's User-Agent is one of APP_USER_AGENTS.
 *
 * This tells the app apart from the website so a book's PDF link can be withheld from the site
 * (books.pdf_access = 'app'). It is a soft gate: the string is in the app's public repo and a User-Agent is
 * trivially copied, so anyone who sends it is the app. Browsers cannot set `User-Agent` from page scripts, so a
 * website visitor cannot send it by accident.
 */
export const appClient = createMiddleware<AppEnv>(async (c, next) => {
  const userAgent = c.req.header('user-agent');
  c.set('isApp', userAgent !== undefined && APP_USER_AGENTS.includes(userAgent));
  await next();
});
