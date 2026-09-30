/**
 * Integration tests for RolesService.
 *
 * What the unit tests (Prisma mocks) cannot show and these do, against a real
 * PostgreSQL (DATABASE_TEST_URL):
 *   - deleting a role is race-safe against a concurrent user_roles insert
 *     (the row lock taken before the "is it assigned?" count);
 *   - role names are unique regardless of letter case, and a rename is audited
 *     with before / after.
 *
 * Run with: npm run test:integration
 */
import { ConflictException } from '@nestjs/common'
import { RolesService } from './roles.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../common/audit/audit.service'
import { prisma, cleanDatabase, settlePendingWrites } from '../../test/db-helpers'

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describeIfDb('RolesService (integration)', () => {
    let service: RolesService
    let actorId: string

    beforeAll(async () => {
        await prisma.$connect()
        await prisma.languages.upsert({
            where: { code: 'ar' },
            create: { code: 'ar', name: 'Arabic', native_name: 'العربية' },
            update: {},
        })
    })
    afterAll(() => prisma.$disconnect())

    beforeEach(async () => {
        await cleanDatabase()
        const audit = new AuditService(prisma as unknown as PrismaService)
        service = new RolesService(prisma as unknown as PrismaService, audit)
        // audit_logs.user_id is a real foreign key, so the actor must exist.
        actorId = (await prisma.users.create({ data: { username: 'role-admin', password_hash: 'x' } })).id
    })

    const newUser = (username: string) => prisma.users.create({ data: { username, password_hash: 'x' } })

    // ─── delete ───────────────────────────────────────────────────────────────

    describe('delete', () => {
        it('removes an unassigned role', async () => {
            const role = await prisma.roles.create({ data: { name: 'lonely' } })

            await service.delete(role.id, actorId)

            expect(await prisma.roles.count({ where: { id: role.id } })).toBe(0)
        })

        it('refuses a role that is already assigned', async () => {
            const role = await prisma.roles.create({ data: { name: 'in-use' } })
            const user = await newUser('holder')
            await prisma.user_roles.create({ data: { user_id: user.id, role_id: role.id } })

            await expect(service.delete(role.id, actorId)).rejects.toThrow(ConflictException)
            expect(await prisma.roles.count({ where: { id: role.id } })).toBe(1)
        })

        it('waits for an in-flight assignment instead of missing it, then refuses — the assignment is not silently cascaded away', async () => {
            const role = await prisma.roles.create({ data: { name: 'racy' } })
            const user = await newUser('assignee')

            let deletion!: Promise<unknown>
            let deletionSettled = false
            await prisma.$transaction(async (tx) => {
                // Uncommitted assignment: its foreign key holds a KEY SHARE lock on the role row.
                await tx.user_roles.create({ data: { user_id: user.id, role_id: role.id } })

                deletion = service.delete(role.id, actorId).then(
                    (value) => value,
                    (err) => err,
                )
                void deletion.finally(() => {
                    deletionSettled = true
                })

                // Long enough for delete() to reach its row lock; it must be BLOCKED behind the open assignment,
                // not have already counted zero assignments and deleted the role.
                await sleep(500)
                expect(deletionSettled).toBe(false)
            })

            const outcome = await deletion
            expect(outcome).toBeInstanceOf(ConflictException)
            expect(await prisma.roles.count({ where: { id: role.id } })).toBe(1)
            expect(await prisma.user_roles.count({ where: { role_id: role.id } })).toBe(1)
        })
    })

    // ─── names ────────────────────────────────────────────────────────────────

    describe('role names are unique regardless of letter case', () => {
        const translations = [{ lang: 'ar', title: 'x' }]

        it('rejects a create that differs from an existing role only in letter case, and stores the trimmed name', async () => {
            const created = await service.create({ name: '  Editor ', translations }, actorId, null)
            expect(created.data.name).toBe('Editor')

            for (const variant of ['editor', 'EDITOR', ' eDiToR ']) {
                await expect(service.create({ name: variant, translations }, actorId, null)).rejects.toThrow(
                    ConflictException,
                )
            }
            expect(await prisma.roles.count()).toBe(1)
        })

        it('rejects a rename onto another role in a different case, but allows a case-only rename of the role itself', async () => {
            const editor = await service.create({ name: 'editor', translations }, actorId, null)
            await service.create({ name: 'Reviewer', translations }, actorId, null)

            await expect(service.update(editor.data.id, { name: 'reviewer' }, actorId, null)).rejects.toThrow(
                ConflictException,
            )

            const renamed = await service.update(editor.data.id, { name: 'Editor' }, actorId, null)
            expect(renamed.data.name).toBe('Editor')
        })

        it('audits a rename with before and after', async () => {
            const role = await service.create({ name: 'old-name', translations }, actorId, null)

            await service.update(role.data.id, { name: 'new-name' }, actorId, null)
            await settlePendingWrites()

            const row = await prisma.audit_logs.findFirst({ where: { action: 'ROLE_UPDATED', resource_id: role.data.id } })
            expect((row!.changes as any).name).toEqual({ before: 'old-name', after: 'new-name' })
        })
    })
})
