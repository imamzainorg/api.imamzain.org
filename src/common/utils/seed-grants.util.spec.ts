import { planRoleGrants } from './seed-grants.util';

const LISTED = ['posts:read', 'posts:create', 'roles:update'];

describe('planRoleGrants', () => {
  it('gives a brand-new role its full default set', () => {
    const plan = planRoleGrants({
      listed: LISTED,
      roleIsNew: true,
      alreadyGranted: new Set(),
      newPermissions: new Set(),
    });

    expect(plan).toEqual({ grant: LISTED, leftRemoved: [] });
  });

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

  it('is a no-op when the role already holds everything', () => {
    const plan = planRoleGrants({
      listed: LISTED,
      roleIsNew: false,
      alreadyGranted: new Set(LISTED),
      newPermissions: new Set(LISTED),
    });

    expect(plan).toEqual({ grant: [], leftRemoved: [] });
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

  it('ignores duplicate names in the listed set', () => {
    const plan = planRoleGrants({
      listed: ['posts:read', 'posts:read'],
      roleIsNew: true,
      alreadyGranted: new Set(),
      newPermissions: new Set(),
    });

    expect(plan.grant).toEqual(['posts:read']);
  });
});
