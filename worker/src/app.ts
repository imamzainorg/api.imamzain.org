import { Hono } from 'hono';

// Ported-group table, middleware and the fallthrough to ORIGIN_URL come in Phase 2 tasks 2–3.
export const app = new Hono<{ Bindings: Env }>();
