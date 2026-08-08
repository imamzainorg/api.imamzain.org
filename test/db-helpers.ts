import { PrismaClient } from '@prisma/client'

/**
 * Shared Prisma client pointed at DATABASE_TEST_URL.
 * Each integration spec file calls prisma.$connect() in beforeAll
 * and prisma.$disconnect() in afterAll.
 */
export const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_TEST_URL } },
})

/**
 * Wipe every table that integration tests touch, in FK-safe order.
 * Call this in beforeEach so every test starts with a clean slate.
 *
 * Cascades handled automatically by the DB:
 *   roles       → role_translations (onDelete: Cascade)
 *   permissions → permission_translations (onDelete: Cascade)
 *
 * Explicit delete order (dependents before parents):
 *   1. audit_logs           FK: user_id → users (nullable)
 *   2. contact_submissions  FK: responded_by → users (nullable)
 *   3. proxy_visit_requests FK: processed_by → users (nullable)
 *   4. user_roles           FK: user_id → users, role_id → roles
 *   5. role_permissions     FK: role_id → roles, permission_id → permissions
 *   6. users                clean now
 *   7. roles                DB cascades → role_translations
 *   8. permissions          DB cascades → permission_translations
 */
export async function cleanDatabase() {
    // AuditService.write() is fire-and-forget: it schedules the INSERT on a
    // later tick and resolves immediately. A write scheduled by the test that
    // just finished can therefore still be in flight here, and would hit a
    // users table this function has already emptied (audit_logs_user_id_fkey).
    // Let the event loop drain those first so the warning spam, and the
    // cross-test interference behind it, does not happen.
    await settlePendingWrites()

    await prisma.audit_logs.deleteMany()
    await prisma.contact_submissions.deleteMany()
    await prisma.proxy_visit_requests.deleteMany()
    await prisma.user_roles.deleteMany()
    await prisma.role_permissions.deleteMany()
    await prisma.users.deleteMany()
    await prisma.roles.deleteMany()
    await prisma.permissions.deleteMany()
}

/**
 * Yield long enough for already-scheduled fire-and-forget writes to reach the
 * database. setImmediate alone only clears the scheduling tick, not the query
 * round-trip, so this also waits on a trivial query.
 */
export async function settlePendingWrites(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve))
    await prisma.$queryRaw`SELECT 1`
}

/**
 * Poll until `read` returns something non-null, or fail after `timeoutMs`.
 *
 * Use this for anything written through AuditService.write(). That path is
 * deliberately fire-and-forget (see the failure policy in audit.service.ts), so
 * the contract is "the row lands shortly after", not "the row exists the
 * instant the mutation resolves". Asserting the latter is a race that passes or
 * fails on scheduler timing. Actions that genuinely need a synchronous
 * guarantee use writeSync instead, and can be asserted directly.
 */
export async function waitForRow<T>(
    read: () => Promise<T | null>,
    { timeoutMs = 5000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const row = await read()
        if (row !== null && row !== undefined) return row
        if (Date.now() >= deadline) return null
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
}
