/**
 * Integration tests for AuthService.
 *
 * These tests talk to a real PostgreSQL database (DATABASE_TEST_URL).
 * They verify that our Prisma queries, bcrypt comparisons, and JWT signing
 * work end-to-end — things mocked unit tests cannot confirm.
 *
 * Prerequisites:
 *   1. Copy .env.test.example to .env.test and fill in DATABASE_TEST_URL.
 *   2. The test DB must have the schema applied (npx prisma db push --skip-generate).
 *   3. Run with: npm run test:integration
 */
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { HttpException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../common/audit/audit.service'
import { LOGIN_FAILURE_THRESHOLD, LoginThrottleService, loginThrottleKey } from './login-throttle.service'
import { prisma, cleanDatabase } from '../../test/db-helpers'

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip

describeIfDb('AuthService (integration)', () => {
    let service: AuthService

    beforeAll(() => prisma.$connect())
    afterAll(() => prisma.$disconnect())

    beforeEach(async () => {
        await cleanDatabase()
        const jwtService = new JwtService({
            secret: process.env.JWT_SECRET ?? 'test-secret',
            signOptions: { expiresIn: '1h' },
        })
        const audit = new AuditService(prisma as unknown as PrismaService)
        const loginThrottle = new LoginThrottleService(prisma as unknown as PrismaService)
        service = new AuthService(prisma as unknown as PrismaService, jwtService, audit, loginThrottle)
    })

    // ─── login ───────────────────────────────────────────────────────────────

    describe('login', () => {
        it('returns a signed JWT and user profile on valid credentials', async () => {
            const hash = await bcrypt.hash('correctpassword', 4)
            await prisma.users.create({ data: { username: 'alice', password_hash: hash } })

            const result = await service.login(
                { username: 'alice', password: 'correctpassword' },
                '127.0.0.1',
                'test-agent',
            )

            expect(typeof result.data.accessToken).toBe('string')
            expect(result.data.accessToken.split('.').length).toBe(3) // valid JWT has 3 parts
            expect(result.data.user.username).toBe('alice')
            expect(result.data.user.roles).toEqual([])
            expect(result.data.user.permissions).toEqual([])
        })

        it('throws UnauthorizedException when the user does not exist', async () => {
            await expect(
                service.login({ username: 'ghost', password: 'any' }, '127.0.0.1', 'agent'),
            ).rejects.toThrow(UnauthorizedException)
        })

        it('throws UnauthorizedException on wrong password', async () => {
            const hash = await bcrypt.hash('realpassword', 4)
            await prisma.users.create({ data: { username: 'bob', password_hash: hash } })

            await expect(
                service.login({ username: 'bob', password: 'wrongpassword' }, '127.0.0.1', 'agent'),
            ).rejects.toThrow(UnauthorizedException)
        })

        it('does not expose soft-deleted users', async () => {
            const hash = await bcrypt.hash('pass', 4)
            await prisma.users.create({
                data: { username: 'deleted_user', password_hash: hash, deleted_at: new Date() },
            })

            await expect(
                service.login({ username: 'deleted_user', password: 'pass' }, '127.0.0.1', 'agent'),
            ).rejects.toThrow(UnauthorizedException)
        })

        it('writes a USER_LOGIN audit log row on success', async () => {
            const hash = await bcrypt.hash('pass', 4)
            await prisma.users.create({ data: { username: 'carol', password_hash: hash } })

            await service.login({ username: 'carol', password: 'pass' }, '10.0.0.1', 'TestBrowser/1.0')

            const log = await prisma.audit_logs.findFirst({ where: { action: 'USER_LOGIN' } })
            expect(log).not.toBeNull()
            expect(log!.ip_address).toBe('10.0.0.1')
        })

        it('returns roles and permissions aggregated from user_roles', async () => {
            // Create user → role → permission chain in the DB
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'dave', password_hash: hash } })

            const perm = await prisma.permissions.create({ data: { name: 'posts:read' } })
            const role = await prisma.roles.create({ data: { name: 'Editor' } })
            await prisma.role_permissions.create({ data: { role_id: role.id, permission_id: perm.id } })
            await prisma.user_roles.create({ data: { user_id: user.id, role_id: role.id } })

            const result = await service.login(
                { username: 'dave', password: 'pass' },
                '127.0.0.1',
                'agent',
            )

            expect(result.data.user.roles).toContain('Editor')
            expect(result.data.user.permissions).toContain('posts:read')
        })
    })

    // ─── per-username lockout ─────────────────────────────────────────────────

    describe('login lockout', () => {
        const failLogin = (username: string) =>
            service.login({ username, password: 'wrong-password' }, '127.0.0.1', 'agent').catch((e) => e)

        it('locks the username after the threshold and rejects even the correct password', async () => {
            const hash = await bcrypt.hash('correctpassword', 4)
            await prisma.users.create({ data: { username: 'heidi', password_hash: hash } })

            for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i++) {
                expect(await failLogin('heidi')).toBeInstanceOf(UnauthorizedException)
            }

            const row = await prisma.login_attempts.findUnique({ where: { username_key: loginThrottleKey('heidi') } })
            expect(row!.failed_count).toBe(LOGIN_FAILURE_THRESHOLD)
            expect(row!.locked_until!.getTime()).toBeGreaterThan(Date.now())

            const locked = await service
                .login({ username: 'heidi', password: 'correctpassword' }, '127.0.0.1', 'agent')
                .catch((e) => e)
            expect(locked).toBeInstanceOf(HttpException)
            expect((locked as HttpException).getStatus()).toBe(429)
            expect((locked as HttpException).getResponse()).toEqual(
                expect.objectContaining({ code: 'AUTH_LOGIN_LOCKED' }),
            )
        })

        it('counts unknown usernames the same way (no existence oracle)', async () => {
            for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i++) await failLogin('nobody-here')

            const locked = await failLogin('nobody-here')
            expect((locked as HttpException).getStatus()).toBe(429)
        })

        it('shares one counter across case variants of the username', async () => {
            await failLogin('Ivan')
            await failLogin('ivan')
            await failLogin(' IVAN')

            const rows = await prisma.login_attempts.findMany()
            expect(rows).toHaveLength(1)
            expect(rows[0].failed_count).toBe(3)
        })

        it('a successful login clears the counter', async () => {
            const hash = await bcrypt.hash('correctpassword', 4)
            await prisma.users.create({ data: { username: 'judy', password_hash: hash } })
            await failLogin('judy')
            await failLogin('judy')

            await service.login({ username: 'judy', password: 'correctpassword' }, '127.0.0.1', 'agent')

            expect(await prisma.login_attempts.count()).toBe(0)
        })

        it('restarts the count after a quiet window', async () => {
            const key = loginThrottleKey('mallory')
            const longAgo = new Date(Date.now() - 60 * 60 * 1000)
            await prisma.login_attempts.create({
                data: { username_key: key, failed_count: 9, first_failed_at: longAgo, last_failed_at: longAgo, locked_until: longAgo },
            })

            await failLogin('mallory')

            const row = await prisma.login_attempts.findUnique({ where: { username_key: key } })
            expect(row!.failed_count).toBe(1)
            expect(row!.locked_until).toBeNull()
        })

        it('writes a USER_LOGIN_FAILED audit row that never contains the attempted username', async () => {
            await failLogin('Tr0ub4dor&3-typed-as-username')

            const log = await prisma.audit_logs.findFirst({ where: { action: 'USER_LOGIN_FAILED' } })
            expect(log).not.toBeNull()
            expect(log!.ip_address).toBe('127.0.0.1')
            expect(JSON.stringify(log)).not.toContain('Tr0ub4dor')
        })
    })

    // ─── refresh-token families (S13) ─────────────────────────────────────────

    describe('refresh-token families', () => {
        const hashOf = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')
        const rowFor = (raw: string) => prisma.refresh_tokens.findUnique({ where: { token_hash: hashOf(raw) } })
        const codeOf = (err: unknown) => (err as UnauthorizedException).getResponse() as { code?: string }

        /** Log in as a user that already exists; every call is a new device / session family. */
        const loginAs = async (username: string) => {
            const result = await service.login({ username, password: 'correctpassword' }, '127.0.0.1', 'agent')
            return result.data.refresh_token
        }

        let userId: string

        beforeEach(async () => {
            const hash = await bcrypt.hash('correctpassword', 4)
            userId = (await prisma.users.create({ data: { username: 'zoe', password_hash: hash } })).id
        })

        it('each login starts a new family; rotation keeps the family and links old row to new', async () => {
            const deviceA = await loginAs('zoe')
            const deviceB = await loginAs('zoe')
            const rowA = (await rowFor(deviceA))!
            const rowB = (await rowFor(deviceB))!
            expect(rowA.family_id).not.toBe(rowB.family_id)

            const rotated = await service.refresh({ refresh_token: deviceA })

            const oldRow = (await rowFor(deviceA))!
            const newRow = (await rowFor(rotated.data.refresh_token))!
            expect(newRow.family_id).toBe(rowA.family_id)
            expect(oldRow.revoked_at).not.toBeNull()
            expect(oldRow.replaced_by_id).toBe(newRow.id)
            expect(newRow.revoked_at).toBeNull()
        })

        it('two concurrent refreshes with the same token BOTH succeed inside the grace window', async () => {
            const token = await loginAs('zoe')

            const [first, second] = await Promise.allSettled([
                service.refresh({ refresh_token: token }),
                service.refresh({ refresh_token: token }),
            ])

            expect(first.status).toBe('fulfilled')
            expect(second.status).toBe('fulfilled')
            const tokens = [first, second].map((r) => (r as PromiseFulfilledResult<any>).value.data.refresh_token)
            expect(tokens[0]).not.toBe(tokens[1])

            // Both new tokens live in the original family, are valid, and nothing was revoked beyond the presented one.
            const family = (await rowFor(token))!.family_id
            const live = await prisma.refresh_tokens.findMany({ where: { user_id: userId, revoked_at: null } })
            expect(live).toHaveLength(2)
            expect(live.every((r) => r.family_id === family)).toBe(true)
            expect(await prisma.audit_logs.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED' } })).toBe(0)
            expect((await prisma.users.findUnique({ where: { id: userId } }))!.token_version).toBe(1)

            // ...and each client can carry on with the token it got.
            await expect(service.refresh({ refresh_token: tokens[0] })).resolves.toBeDefined()
            await expect(service.refresh({ refresh_token: tokens[1] })).resolves.toBeDefined()
        })

        it('a burst of concurrent refreshes with one token all succeed and stay in one family', async () => {
            for (let round = 0; round < 3; round++) {
                const token = await loginAs('zoe')

                const results = await Promise.allSettled(
                    Array.from({ length: 5 }, () => service.refresh({ refresh_token: token })),
                )

                expect(results.map((r) => r.status)).toEqual(Array(5).fill('fulfilled'))
                const family = (await rowFor(token))!.family_id
                const inFamily = await prisma.refresh_tokens.findMany({ where: { family_id: family, revoked_at: null } })
                expect(inFamily).toHaveLength(5)
            }
            expect(await prisma.audit_logs.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED' } })).toBe(0)
        })

        it('a sequential replay just after rotation is still a benign refresh', async () => {
            const token = await loginAs('zoe')
            await service.refresh({ refresh_token: token })

            await expect(service.refresh({ refresh_token: token })).resolves.toBeDefined()
        })

        it('reuse AFTER the grace window revokes only that family and leaves the other device valid', async () => {
            const deviceA = await loginAs('zoe')
            const deviceB = await loginAs('zoe')
            const rotatedA = await service.refresh({ refresh_token: deviceA })
            // Pretend the rotation happened five minutes ago.
            await prisma.refresh_tokens.update({
                where: { token_hash: hashOf(deviceA) },
                data: { revoked_at: new Date(Date.now() - 5 * 60_000) },
            })

            const err = await service.refresh({ refresh_token: deviceA }, '203.0.113.9', 'thief-agent').catch((e) => e)

            expect(err).toBeInstanceOf(UnauthorizedException)
            expect(codeOf(err).code).toBe('AUTH_TOKEN_REUSED')
            // Family A is dead, including the token the real client was holding...
            expect((await rowFor(rotatedA.data.refresh_token))!.revoked_at).not.toBeNull()
            await expect(service.refresh({ refresh_token: rotatedA.data.refresh_token })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
            // ...while device B is untouched: its token is live, still rotates, and the user's access tokens were not invalidated.
            expect((await rowFor(deviceB))!.revoked_at).toBeNull()
            expect((await prisma.users.findUnique({ where: { id: userId } }))!.token_version).toBe(1)
            await expect(service.refresh({ refresh_token: deviceB })).resolves.toBeDefined()

            const audit = await prisma.audit_logs.findFirst({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED' } })
            expect(audit).not.toBeNull()
            expect(audit!.user_id).toBe(userId)
            expect(audit!.ip_address).toBe('203.0.113.9')
            expect((audit!.changes as any).family_id).toBe((await rowFor(deviceA))!.family_id)
            const serialized = JSON.stringify(audit)
            expect(serialized).not.toContain(deviceA)
            expect(serialized).not.toContain(rotatedA.data.refresh_token)
            expect(serialized).not.toContain(hashOf(deviceA))
        })

        it('a token revoked by logout cannot refresh, and does not sign out the other device', async () => {
            const deviceA = await loginAs('zoe')
            const deviceB = await loginAs('zoe')
            await service.logout(userId, deviceA)

            const err = await service.refresh({ refresh_token: deviceA }).catch((e) => e)

            expect(err).toBeInstanceOf(UnauthorizedException)
            expect(codeOf(err).code).toBe('AUTH_REFRESH_INVALID')
            expect((await rowFor(deviceB))!.revoked_at).toBeNull()
            await expect(service.refresh({ refresh_token: deviceB })).resolves.toBeDefined()
            expect(await prisma.audit_logs.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED' } })).toBe(0)
            expect(await prisma.audit_logs.count({ where: { action: 'USER_LOGOUT' } })).toBe(1)
        })

        it('logging out ends the whole session family, siblings included, and a token from the grace window cannot revive it', async () => {
            const token = await loginAs('zoe')
            const winner = await service.refresh({ refresh_token: token })
            const sibling = await service.refresh({ refresh_token: token }) // benign second refresh: same family
            await service.logout(userId, winner.data.refresh_token)

            expect((await rowFor(sibling.data.refresh_token))!.revoked_at).not.toBeNull()
            const err = await service.refresh({ refresh_token: token }).catch((e) => e)
            expect(codeOf(err).code).toBe('AUTH_REFRESH_INVALID')
        })

        it('logout-all still revokes everything and invalidates access tokens', async () => {
            const deviceA = await loginAs('zoe')
            const deviceB = await loginAs('zoe')

            await service.logout(userId, undefined, '127.0.0.1', 'agent')

            for (const token of [deviceA, deviceB]) {
                const err = await service.refresh({ refresh_token: token }).catch((e) => e)
                expect(err).toBeInstanceOf(UnauthorizedException)
                expect(codeOf(err).code).toBe('AUTH_REFRESH_INVALID')
            }
            expect(await prisma.refresh_tokens.count({ where: { user_id: userId, revoked_at: null } })).toBe(0)
            expect((await prisma.users.findUnique({ where: { id: userId } }))!.token_version).toBe(2)
            const audit = await prisma.audit_logs.findFirst({ where: { action: 'USER_LOGOUT_ALL' } })
            expect(audit).not.toBeNull()
            expect((audit!.changes as any).revoked_tokens).toBe(2)
        })

        it('rows written without a family (the previous app version) get their own family from the column default', async () => {
            const row = await prisma.refresh_tokens.create({
                data: { user_id: userId, token_hash: hashOf('legacy-token'), expires_at: new Date(Date.now() + 86_400_000) },
            })

            expect(row.family_id).toMatch(/^[0-9a-f-]{36}$/)
            expect(row.replaced_by_id).toBeNull()
            await expect(service.refresh({ refresh_token: 'legacy-token' })).resolves.toBeDefined()
        })
    })

    // ─── forced password change flag (B-RBAC2) ────────────────────────────────

    describe('must_change_password', () => {
        it('is false for a normal account, on login and on /auth/me', async () => {
            const hash = await bcrypt.hash('correctpassword', 4)
            const user = await prisma.users.create({ data: { username: 'norm', password_hash: hash } })

            const login = await service.login({ username: 'norm', password: 'correctpassword' }, '127.0.0.1', 'agent')
            const me = await service.getMe(user.id)

            expect(login.data.user.must_change_password).toBe(false)
            expect(me.data.must_change_password).toBe(false)
        })

        it('is reported once set, and cleared by the user changing their own password', async () => {
            const hash = await bcrypt.hash('temporary-pass', 4)
            const user = await prisma.users.create({
                data: { username: 'flagged', password_hash: hash, must_change_password: true },
            })

            const login = await service.login({ username: 'flagged', password: 'temporary-pass' }, '127.0.0.1', 'agent')
            expect(login.data.user.must_change_password).toBe(true)
            expect((await service.getMe(user.id)).data.must_change_password).toBe(true)

            await service.changePassword(user.id, { currentPassword: 'temporary-pass', newPassword: 'my-own-password' }, '127.0.0.1')

            expect((await prisma.users.findUnique({ where: { id: user.id } }))!.must_change_password).toBe(false)
            expect((await service.getMe(user.id)).data.must_change_password).toBe(false)
        })
    })

    // ─── changePassword ───────────────────────────────────────────────────────

    describe('changePassword', () => {
        it('stores a new bcrypt hash and the old password no longer works', async () => {
            const hash = await bcrypt.hash('oldpass', 4)
            const user = await prisma.users.create({ data: { username: 'eve', password_hash: hash } })

            await service.changePassword(
                user.id,
                { currentPassword: 'oldpass', newPassword: 'newpass' },
                '127.0.0.1',
            )

            const row = await prisma.users.findUnique({ where: { id: user.id } })
            expect(await bcrypt.compare('newpass', row!.password_hash)).toBe(true)
            expect(await bcrypt.compare('oldpass', row!.password_hash)).toBe(false)
        })

        it('throws and leaves the hash unchanged when current password is wrong', async () => {
            const hash = await bcrypt.hash('mypassword', 4)
            const user = await prisma.users.create({ data: { username: 'frank', password_hash: hash } })

            await expect(
                service.changePassword(
                    user.id,
                    { currentPassword: 'wrongpass', newPassword: 'new' },
                    '127.0.0.1',
                ),
            ).rejects.toThrow(UnauthorizedException)

            const row = await prisma.users.findUnique({ where: { id: user.id } })
            expect(row!.password_hash).toBe(hash)
        })
    })

    // ─── getMe ────────────────────────────────────────────────────────────────

    describe('getMe', () => {
        it('returns the user profile without password_hash', async () => {
            const hash = await bcrypt.hash('pass', 4)
            const user = await prisma.users.create({ data: { username: 'grace', password_hash: hash } })

            const result = await service.getMe(user.id)

            expect(result.data.id).toBe(user.id)
            expect(result.data.username).toBe('grace')
            expect(result.data).not.toHaveProperty('password_hash')
        })

        it('throws UnauthorizedException for an unknown user id', async () => {
            await expect(service.getMe('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
                UnauthorizedException,
            )
        })
    })
})
