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
    await prisma.audit_logs.deleteMany()
    await prisma.contact_submissions.deleteMany()
    await prisma.proxy_visit_requests.deleteMany()
    await prisma.user_roles.deleteMany()
    await prisma.role_permissions.deleteMany()
    await prisma.users.deleteMany()
    await prisma.roles.deleteMany()
    await prisma.permissions.deleteMany()
}
