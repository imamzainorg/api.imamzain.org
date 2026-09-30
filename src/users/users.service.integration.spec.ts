/**
 * Integration tests for UsersService.
 *
 * What unit tests assume (via Prisma mocks) that these tests actually confirm:
 *   - Pagination skip/take arithmetic is correct against a real row count.
 *   - soft-deleted rows are filtered by `deleted_at: null`.
 *   - `select` / `include` clauses return the shape the service expects.
 *   - Unique-constraint violations translate to ConflictException.
 *   - `softDelete` sets deleted_at without removing the row.
 *
 * Run with: npm run test:integration
 */
import * as bcrypt from 'bcryptjs'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../common/audit/audit.service'
import { prisma, cleanDatabase, settlePendingWrites } from '../../test/db-helpers'

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip

// Envelope-checked routes take the acting user's payload. An actor with no
// permissions can still manage users whose roles grant nothing (the fixtures
// here), and its non-UUID id never trips the self-delete guard.
const actor = { id: 'actor', username: 'tester', permissions: [] as string[] }

describeIfDb('UsersService (integration)', () => {
    let service: UsersService

    beforeAll(() => prisma.$connect())
    afterAll(() => prisma.$disconnect())

    beforeEach(async () => {
        await cleanDatabase()
        const audit = new AuditService(prisma as unknown as PrismaService)
        service = new UsersService(prisma as unknown as PrismaService, audit)
    })

    // ─── create ───────────────────────────────────────────────────────────────

    describe('create', () => {
        it('inserts a row with a real bcrypt hash and omits password_hash from the response', async () => {
            const result = await service.create({ username: 'newuser', password: 'secret' }, 'actor-id')

            expect(result.message).toBe('User created')
            expect(result.data).not.toHaveProperty('password_hash')
            expect(result.data.username).toBe('newuser')

            // Confirm the DB row has a valid hash for the given password
            const row = await prisma.users.findFirst({ where: { username: 'newuser' } })
            expect(row).not.toBeNull()
            expect(await bcrypt.compare('secret', row!.password_hash)).toBe(true)
        })

        it('throws ConflictException when the username is already taken', async () => {
            await service.create({ username: 'taken', password: 'first' }, 'actor')

            await expect(
                service.create({ username: 'taken', password: 'second' }, 'actor'),
            ).rejects.toThrow(ConflictException)
        })

        it('allows the same username to be reused after the first user is soft-deleted', async () => {
            const first = await service.create({ username: 'reusable', password: 'pass' }, 'actor')
            await service.softDelete(first.data.id, actor)

            // Soft-deleted user should not block a new one with the same name
            await expect(
                service.create({ username: 'reusable', password: 'newpass' }, 'actor'),
            ).resolves.toBeDefined()
        })
    })

    // ─── usernames: trimmed on write, unique regardless of letter case ─────────

    describe('username uniqueness (case-insensitive)', () => {
        it('rejects a create that differs from a live username only in letter case', async () => {
            await service.create({ username: 'Admin', password: 'first-password' }, 'actor')

            for (const variant of ['admin', 'ADMIN', 'aDmIn']) {
                await expect(service.create({ username: variant, password: 'second-password' }, 'actor')).rejects.toThrow(
                    ConflictException,
                )
            }
            expect(await prisma.users.count()).toBe(1)
        })

        it('stores the trimmed username and rejects a padded look-alike of an existing one', async () => {
            const created = await service.create({ username: '  padded  ', password: 'first-password' }, 'actor')
            expect(created.data.username).toBe('padded')

            await expect(service.create({ username: 'padded ', password: 'second-password' }, 'actor')).rejects.toThrow(
                ConflictException,
            )
        })

        it('does not treat a soft-deleted account as a collision', async () => {
            const first = await service.create({ username: 'Gone', password: 'first-password' }, 'actor')
            await service.softDelete(first.data.id, actor)

            await expect(service.create({ username: 'gone', password: 'second-password' }, 'actor')).resolves.toBeDefined()
        })

        it('rejects a rename onto another live account\'s name in a different case, but allows a case-only rename of your own', async () => {
            const alice = await service.create({ username: 'alice', password: 'first-password' }, 'actor')
            await service.create({ username: 'Bob', password: 'first-password' }, 'actor')

            await expect(service.update(alice.data.id, { username: 'bob' }, actor)).rejects.toThrow(ConflictException)

            const renamed = await service.update(alice.data.id, { username: 'Alice' }, actor)
            expect(renamed.data.username).toBe('Alice')
        })

        it('audits the rename with before and after', async () => {
            // audit_logs.user_id is a real foreign key, so the actor must exist.
            const realActor = await prisma.users.create({ data: { username: 'auditor', password_hash: 'x' } })
            const user = await service.create({ username: 'before-name', password: 'first-password' }, realActor.id)

            await service.update(user.data.id, { username: 'after-name' }, { ...actor, id: realActor.id })
            await settlePendingWrites()

            const row = await prisma.audit_logs.findFirst({
                where: { action: 'USER_UPDATED', resource_id: user.data.id },
            })
            expect((row!.changes as any).username).toEqual({ before: 'before-name', after: 'after-name' })
        })

        it('refuses to restore a user whose original name was reclaimed in another case', async () => {
            const first = await service.create({ username: 'Reclaimed', password: 'first-password' }, 'actor')
            await service.softDelete(first.data.id, actor)
            await service.create({ username: 'reclaimed', password: 'second-password' }, 'actor')

            await expect(service.restore(first.data.id, actor)).rejects.toThrow(ConflictException)
        })
    })

    // ─── admin password reset ─────────────────────────────────────────────────

    describe('adminResetPassword', () => {
        it('flags the account must_change_password and ends its sessions', async () => {
            const hash = await bcrypt.hash('old-password', 4)
            const user = await prisma.users.create({ data: { username: 'forgetful', password_hash: hash } })
            await prisma.refresh_tokens.create({
                data: { user_id: user.id, token_hash: 'hash-1', expires_at: new Date(Date.now() + 86_400_000) },
            })

            await service.adminResetPassword(user.id, { new_password: 'temporary-password' }, actor)

            const row = await prisma.users.findUnique({ where: { id: user.id } })
            expect(row!.must_change_password).toBe(true)
            expect(row!.token_version).toBe(2)
            expect(await bcrypt.compare('temporary-password', row!.password_hash)).toBe(true)
            expect(await prisma.refresh_tokens.count({ where: { user_id: user.id, revoked_at: null } })).toBe(0)
        })
    })

    // ─── findAll ──────────────────────────────────────────────────────────────

    describe('findAll', () => {
        it('returns correct total count and paginated slice', async () => {
            const hash = await bcrypt.hash('pass', 4)
            await prisma.users.createMany({
                data: [
                    { username: 'user1', password_hash: hash },
                    { username: 'user2', password_hash: hash },
                    { username: 'user3', password_hash: hash },
                ],
            })

            const page1 = await service.findAll(1, 2)
            expect(page1.data.items).toHaveLength(2)
            expect(page1.data.pagination.total).toBe(3)
            expect(page1.data.pagination.pages).toBe(2)

            const page2 = await service.findAll(2, 2)
            expect(page2.data.items).toHaveLength(1)
        })

        it('excludes soft-deleted users from both results and count', async () => {
            const hash = await bcrypt.hash('pass', 4)
            await prisma.users.createMany({
                data: [
                    { username: 'active', password_hash: hash },
                    { username: 'deleted', password_hash: hash, deleted_at: new Date() },
                ],
            })

            const result = await service.findAll(1, 10)
            const usernames = result.data.items.map((u: any) => u.username)

            expect(result.data.pagination.total).toBe(1)
            expect(usernames).toContain('active')
            expect(usernames).not.toContain('deleted')
        })
    })

    // ─── findOne ──────────────────────────────────────────────────────────────

    describe('findOne', () => {
        it('returns user data without password_hash', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'findme', password_hash: hash } })

            const result = await service.findOne(user.id)

            expect(result.data.id).toBe(user.id)
            expect(result.data.username).toBe('findme')
            expect(result.data).not.toHaveProperty('password_hash')
        })

        it('aggregates permissions from assigned roles', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'withperms', password_hash: hash } })
            const perm = await prisma.permissions.create({ data: { name: 'users:read' } })
            const role = await prisma.roles.create({ data: { name: 'Admin' } })
            await prisma.role_permissions.create({ data: { role_id: role.id, permission_id: perm.id } })
            await prisma.user_roles.create({ data: { user_id: user.id, role_id: role.id } })

            const result = await service.findOne(user.id)

            expect(result.data.permissions).toContain('users:read')
        })

        it('throws NotFoundException for an unknown id', async () => {
            await expect(
                service.findOne('00000000-0000-0000-0000-000000000000'),
            ).rejects.toThrow(NotFoundException)
        })
    })

    // ─── update ───────────────────────────────────────────────────────────────

    describe('update', () => {
        it('renames the user and omits password_hash from response', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'beforerename', password_hash: hash } })

            const result = await service.update(user.id, { username: 'afterrename' }, actor)

            expect(result.data.username).toBe('afterrename')
            expect(result.data).not.toHaveProperty('password_hash')

            const row = await prisma.users.findUnique({ where: { id: user.id } })
            expect(row!.username).toBe('afterrename')
        })

        it('throws ConflictException when the new username belongs to another user', async () => {
            const hash = await bcrypt.hash('pass', 4)
            await prisma.users.createMany({
                data: [
                    { username: 'userA', password_hash: hash },
                    { username: 'userB', password_hash: hash },
                ],
            })
            const userA = await prisma.users.findFirst({ where: { username: 'userA' } })

            await expect(
                service.update(userA!.id, { username: 'userB' }, actor),
            ).rejects.toThrow(ConflictException)
        })
    })

    // ─── softDelete ───────────────────────────────────────────────────────────

    describe('softDelete', () => {
        it('sets deleted_at on the row without removing it from the database', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'todelete', password_hash: hash } })

            await service.softDelete(user.id, actor)

            const row = await prisma.users.findUnique({ where: { id: user.id } })
            expect(row).not.toBeNull()       // row still exists
            expect(row!.deleted_at).not.toBeNull() // but is marked deleted
        })

        it('makes the user invisible to findOne after soft deletion', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'softdeleted', password_hash: hash } })

            await service.softDelete(user.id, actor)

            await expect(service.findOne(user.id)).rejects.toThrow(NotFoundException)
        })

        it('throws NotFoundException for an unknown id', async () => {
            await expect(
                service.softDelete('00000000-0000-0000-0000-000000000000', actor),
            ).rejects.toThrow(NotFoundException)
        })
    })

    // ─── assignRole / removeRole ──────────────────────────────────────────────

    describe('assignRole / removeRole', () => {
        // Roles created here carry no permissions, so they are within any
        // actor's envelope and the privilege-subset guard passes.
        const actor = { id: 'actor', username: 'tester', permissions: [] as string[] }

        it('creates a user_roles row and removes it correctly', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'roleuser', password_hash: hash } })
            const role = await prisma.roles.create({ data: { name: 'Moderator' } })

            await service.assignRole(user.id, { role_id: role.id }, actor)

            const assigned = await prisma.user_roles.findFirst({
                where: { user_id: user.id, role_id: role.id },
            })
            expect(assigned).not.toBeNull()

            await service.removeRole(user.id, role.id, actor)

            const removed = await prisma.user_roles.findFirst({
                where: { user_id: user.id, role_id: role.id },
            })
            expect(removed).toBeNull()
        })

        it('is idempotent — assigning the same role twice does not throw', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'idempotent', password_hash: hash } })
            const role = await prisma.roles.create({ data: { name: 'Viewer' } })

            await service.assignRole(user.id, { role_id: role.id }, actor)
            await expect(
                service.assignRole(user.id, { role_id: role.id }, actor),
            ).resolves.toBeDefined()
        })
    })
})
