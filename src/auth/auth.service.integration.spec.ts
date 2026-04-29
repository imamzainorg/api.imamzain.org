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
import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { PrismaService } from '../prisma/prisma.service'
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
        service = new AuthService(prisma as unknown as PrismaService, jwtService)
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
