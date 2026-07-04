import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { ForbiddenErrorDto, UnauthorizedErrorDto } from '../dto/api-response.dto';

/**
 * Protect a route with JWT auth + the permission guard, document the bearer
 * requirement in OpenAPI, and declare the standard 401/403 responses.
 *
 * Replaces the five-decorator stack that was repeated verbatim on ~107 routes:
 *
 *   @UseGuards(JwtAuthGuard, PermissionGuard)
 *   @ApiBearerAuth('jwt')
 *   @RequirePermission(...perms)
 *   @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
 *   @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
 *
 * Routes with a non-standard 401/403 description (e.g. contest's
 * `Missing \`contest:read\` permission`) keep their decorators inline.
 */
export function Auth(...permissions: string[]) {
  return applyDecorators(
    UseGuards(JwtAuthGuard, PermissionGuard),
    ApiBearerAuth('jwt'),
    RequirePermission(...permissions),
    ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' }),
    ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' }),
  );
}

/**
 * Authenticate a route with JWT only — no specific permission required.
 * Documents the bearer requirement and the standard 401. Used by self-service
 * auth routes (e.g. /auth/me, /auth/logout).
 */
export function AuthOnly() {
  return applyDecorators(
    UseGuards(JwtAuthGuard),
    ApiBearerAuth('jwt'),
    ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' }),
  );
}
