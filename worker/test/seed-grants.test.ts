import { describe, expect, it } from 'vitest';
import { planRoleGrants } from '../../prisma/lib/seed-grants';

const LISTED = ['posts:read', 'posts:create', 'roles:update'];

describe('planRoleGrants', () => {
  it('never re-grants a permission an administrator removed from an existing role', () => {
    const plan = planRoleGrants({
      listed: LISTED,
      roleIsNew: false,
      alreadyGranted: new Set(['posts:read', 'posts:create']),
      newPermissions: new Set(),
    });

    expect(plan).toEqual({ grant: [], leftRemoved: ['roles:update'] });
  });

  it('still delivers a permission that this run created to the existing roles that list it', () => {
    const plan = planRoleGrants({
      listed: [...LISTED, 'slug-redirects:manage'],
      roleIsNew: false,
      alreadyGranted: new Set(['posts:read', 'posts:create']),
      newPermissions: new Set(['slug-redirects:manage']),
    });

    expect(plan.grant).toEqual(['slug-redirects:manage']);
    expect(plan.leftRemoved).toEqual(['roles:update']);
  });

  it('re-applies every default only when reset is asked for', () => {
    const plan = planRoleGrants({
      listed: LISTED,
      roleIsNew: false,
      alreadyGranted: new Set(['posts:read']),
      newPermissions: new Set(),
      reset: true,
    });

    expect(plan).toEqual({ grant: ['posts:create', 'roles:update'], leftRemoved: [] });
  });
});
