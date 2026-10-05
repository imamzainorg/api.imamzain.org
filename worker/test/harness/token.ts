import { sign } from 'hono/jwt';
import pg from 'pg';

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** A query function on `url`, plus close(). */
export function connect(url: string): { q: Query; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  return {
    q: async (sql, params) => (await pool.query(sql, params)).rows,
    close: () => pool.end(),
  };
}

/**
 * An access token for the first live super-admin, shaped like the one AuthService.login signs (sub,
 * username, flattened permissions, token_version). Minted rather than logged in, so the DB gets no
 * refresh-token or audit row and copies A and B stay identical.
 */
export async function adminToken(q: Query, secret: string): Promise<string> {
  const [user] = await q(
    `SELECT u.id, u.username, u.token_version
     FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'super-admin' AND u.deleted_at IS NULL
     ORDER BY u.created_at, u.id LIMIT 1`,
  );
  if (!user) throw new Error('no live super-admin user in the DB (CI: run the seed with SEED_ADMIN_PASSWORD)');
  const perms = await q(
    `SELECT DISTINCT p.name FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1 ORDER BY p.name`,
    [user.id],
  );
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: user.id, username: user.username, permissions: perms.map((p) => p.name), token_version: user.token_version, iat: now, exp: now + 3600 },
    secret,
    'HS256',
  );
}
