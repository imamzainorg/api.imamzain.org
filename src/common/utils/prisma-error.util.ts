import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Rethrow a Prisma unique-constraint violation (P2002) as a 409 with a
 * domain-specific message; rethrow anything else untouched.
 */
export function rethrowP2002AsConflict(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictException(message);
  }
  throw err;
}
