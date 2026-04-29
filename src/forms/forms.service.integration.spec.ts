/**
 * Integration tests for FormsService.
 *
 * Strategy:
 *   - PrismaService   → real database (DATABASE_TEST_URL)
 *   - EmailService    → mock (external SMTP; not the thing being tested)
 *   - WhatsappService → mock (external Twilio; not the thing being tested)
 *
 * What these tests confirm that mocked unit tests cannot:
 *   - contact_submissions and proxy_visit_requests rows are actually created.
 *   - Status transitions update the correct columns (processed_by, processed_at).
 *   - soft-delete sets deleted_at without removing the row.
 *   - NotFoundException is thrown when a record is not found in the real DB.
 *   - WhatsApp notification is triggered only on PENDING→COMPLETED transition.
 *
 * Run with: npm run test:integration
 */
import * as bcrypt from 'bcryptjs'
import { NotFoundException } from '@nestjs/common'
import { FormsService } from './forms.service'
import { PrismaService } from '../prisma/prisma.service'
import { EmailService } from '../email/email.service'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { prisma, cleanDatabase } from '../../test/db-helpers'

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip

// Explicit mock objects — no jest.mock() hoisting needed here.
// These replace the external I/O layers so tests stay DB-only.
const mockEmail = {
    send: jest.fn().mockResolvedValue(true),
    notifyContactSubmission: jest.fn().mockResolvedValue(true),
    notifyProxyVisit: jest.fn().mockResolvedValue(true),
}

const mockWhatsapp = {
    sendProxyVisitCompletion: jest.fn().mockResolvedValue(true),
}

describeIfDb('FormsService (integration)', () => {
    let service: FormsService
    let adminId: string

    beforeAll(() => prisma.$connect())
    afterAll(() => prisma.$disconnect())

    beforeEach(async () => {
        await cleanDatabase()
        jest.clearAllMocks()

        // Create a real admin user so FK columns (processed_by, responded_by) are valid UUIDs
        const hash = await bcrypt.hash('pass', 4)
        const admin = await prisma.users.create({
            data: { username: 'testadmin', password_hash: hash },
        })
        adminId = admin.id

        service = new FormsService(
            prisma as unknown as PrismaService,
            mockEmail as unknown as EmailService,
            mockWhatsapp as unknown as WhatsappService,
        )
    })

    // ─── submitContact ────────────────────────────────────────────────────────

    describe('submitContact', () => {
        it('persists the submission with status NEW', async () => {
            const result = await service.submitContact({
                name: 'Ali Hassan',
                email: 'ali@test.com',
                country: 'IQ',
                message: 'Hello from Baghdad',
            })

            expect(result.message).toBe('Contact submission received')
            expect(result.data.id).toBeDefined()

            const row = await prisma.contact_submissions.findUnique({ where: { id: result.data.id } })
            expect(row).not.toBeNull()
            expect(row!.name).toBe('Ali Hassan')
            expect(row!.status).toBe('NEW')
        })

        it('creates an audit_log row with action CONTACT_SUBMITTED', async () => {
            await service.submitContact({
                name: 'Audit Test',
                email: 'audit@example.com',
                message: 'Testing audit log creation',
            })

            const log = await prisma.audit_logs.findFirst({ where: { action: 'CONTACT_SUBMITTED' } })
            expect(log).not.toBeNull()
            expect(log!.resource_type).toBe('contact_submission')
        })
    })

    // ─── updateContact ────────────────────────────────────────────────────────

    describe('updateContact', () => {
        it('transitions status from NEW to RESPONDED and sets responded_by', async () => {
            const submission = await service.submitContact({
                name: 'Respond Me',
                email: 'respond@test.com',
                message: 'Please respond to this message',
            })

            const result = await service.updateContact(
                submission.data.id,
                { status: 'RESPONDED' },
                adminId,
            )

            expect(result.data.status).toBe('RESPONDED')

            const row = await prisma.contact_submissions.findUnique({
                where: { id: submission.data.id },
            })
            expect(row!.responded_by).toBe(adminId)
            expect(row!.responded_at).not.toBeNull()
        })

        it('throws NotFoundException for an unknown submission id', async () => {
            await expect(
                service.updateContact('00000000-0000-0000-0000-000000000000', { status: 'SPAM' }, adminId),
            ).rejects.toThrow(NotFoundException)
        })
    })

    // ─── softDeleteContact ────────────────────────────────────────────────────

    describe('softDeleteContact', () => {
        it('sets deleted_at without removing the row', async () => {
            const submission = await service.submitContact({
                name: 'Delete Me',
                email: 'delete@test.com',
                message: 'This will be soft deleted',
            })

            await service.softDeleteContact(submission.data.id, adminId)

            const row = await prisma.contact_submissions.findUnique({
                where: { id: submission.data.id },
            })
            expect(row!.deleted_at).not.toBeNull()
        })
    })

    // ─── submitProxyVisit ─────────────────────────────────────────────────────

    describe('submitProxyVisit', () => {
        it('persists the request with status PENDING', async () => {
            const result = await service.submitProxyVisit({
                visitor_name: 'Fatima Al-Zahra',
                visitor_phone: '+9647001234567',
                visitor_country: 'IQ',
            })

            expect(result.data.status).toBe('PENDING')

            const row = await prisma.proxy_visit_requests.findUnique({ where: { id: result.data.id } })
            expect(row!.name).toBe('Fatima Al-Zahra')
            expect(row!.phone).toBe('+9647001234567')
        })
    })

    // ─── updateProxyVisit ─────────────────────────────────────────────────────

    describe('updateProxyVisit', () => {
        it('transitions PENDING → APPROVED and sets processed_by', async () => {
            const created = await service.submitProxyVisit({
                visitor_name: 'Hassan Ali',
                visitor_phone: '+9647001234567',
                visitor_country: 'IQ',
            })

            const result = await service.updateProxyVisit(
                created.data.id,
                { status: 'APPROVED' },
                adminId,
            )

            expect(result.data.status).toBe('APPROVED')

            const row = await prisma.proxy_visit_requests.findUnique({ where: { id: created.data.id } })
            expect(row!.status).toBe('APPROVED')
            expect(row!.processed_by).toBe(adminId)
            expect(row!.processed_at).not.toBeNull()
        })

        it('transitions PENDING → COMPLETED and fires WhatsApp notification', async () => {
            const created = await service.submitProxyVisit({
                visitor_name: 'Zainab',
                visitor_phone: '+9647001234567',
                visitor_country: 'IQ',
            })

            await service.updateProxyVisit(created.data.id, { status: 'COMPLETED' }, adminId)

            // sendProxyVisitCompletion is fire-and-forget (.catch(() => {}))
            // The call is initiated synchronously before the function returns,
            // so the mock is already recorded by this point.
            expect(mockWhatsapp.sendProxyVisitCompletion).toHaveBeenCalledWith(
                '+9647001234567',
                'Zainab',
            )
        })

        it('does NOT fire WhatsApp when already COMPLETED → COMPLETED', async () => {
            const created = await service.submitProxyVisit({
                visitor_name: 'Test',
                visitor_phone: '+9647001234567',
                visitor_country: 'IQ',
            })

            // First transition: PENDING → COMPLETED (triggers notification)
            await service.updateProxyVisit(created.data.id, { status: 'COMPLETED' }, adminId)
            jest.clearAllMocks()

            // Second update: COMPLETED → COMPLETED (should NOT re-trigger)
            await service.updateProxyVisit(created.data.id, { status: 'COMPLETED' }, adminId)

            expect(mockWhatsapp.sendProxyVisitCompletion).not.toHaveBeenCalled()
        })

        it('throws NotFoundException for an unknown id', async () => {
            await expect(
                service.updateProxyVisit(
                    '00000000-0000-0000-0000-000000000000',
                    { status: 'APPROVED' },
                    adminId,
                ),
            ).rejects.toThrow(NotFoundException)
        })
    })

    // ─── softDeleteProxyVisit ─────────────────────────────────────────────────

    describe('softDeleteProxyVisit', () => {
        it('sets deleted_at without removing the row', async () => {
            const created = await service.submitProxyVisit({
                visitor_name: 'Delete Me',
                visitor_phone: '+9647001234567',
                visitor_country: 'IQ',
            })

            await service.softDeleteProxyVisit(created.data.id, adminId)

            const row = await prisma.proxy_visit_requests.findUnique({ where: { id: created.data.id } })
            expect(row!.deleted_at).not.toBeNull()
        })
    })

    // ─── findAllProxyVisits ───────────────────────────────────────────────────

    describe('findAllProxyVisits', () => {
        it('returns only non-deleted records and correct pagination', async () => {
            await service.submitProxyVisit({ visitor_name: 'V1', visitor_phone: '+9647001234567', visitor_country: 'IQ' })
            await service.submitProxyVisit({ visitor_name: 'V2', visitor_phone: '+9647001234567', visitor_country: 'IQ' })
            const v3 = await service.submitProxyVisit({ visitor_name: 'V3', visitor_phone: '+9647001234567', visitor_country: 'IQ' })
            await service.softDeleteProxyVisit(v3.data.id, adminId)

            const result = await service.findAllProxyVisits(1, 10)

            expect(result.data.pagination.total).toBe(2)
            const names = result.data.items.map((r: any) => r.name)
            expect(names).not.toContain('V3')
        })

        it('filters by status when provided', async () => {
            const v1 = await service.submitProxyVisit({ visitor_name: 'Pending1', visitor_phone: '+9647001234567', visitor_country: 'IQ' })
            await service.updateProxyVisit(v1.data.id, { status: 'APPROVED' }, adminId)
            await service.submitProxyVisit({ visitor_name: 'Pending2', visitor_phone: '+9647001234567', visitor_country: 'IQ' })

            const result = await service.findAllProxyVisits(1, 10, 'APPROVED')

            expect(result.data.pagination.total).toBe(1)
            expect(result.data.items[0].name).toBe('Pending1')
        })
    })
})
