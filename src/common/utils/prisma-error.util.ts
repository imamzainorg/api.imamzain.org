import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** The violated index / columns of a P2002, flattened to one searchable string. */
function uniqueTargetOf(err: Prisma.PrismaClientKnownRequestError): string {
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.join(',');
  return typeof target === 'string' ? target : '';
}

/**
 * Rethrow a Prisma unique-constraint violation (P2002) as a 409 with a
 * domain-specific message; rethrow anything else untouched.
 *
 * A table with several unique indexes can pass `byTarget`: the first entry
 * whose key appears in the violated index name / column list wins, so a
 * part-number collision isn't reported as "slug already used". `message` stays
 * the fallback.
 */
export function rethrowP2002AsConflict(err: unknown, message: string, byTarget?: Record<string, string>): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    if (byTarget) {
      const target = uniqueTargetOf(err);
      for (const [needle, specific] of Object.entries(byTarget)) {
        if (target.includes(needle)) throw new ConflictException(specific);
      }
    }
    throw new ConflictException(message);
  }
  throw err;
}

/** True for a Prisma unique-constraint violation (P2002), whatever index it was. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
