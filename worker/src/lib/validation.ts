import type { Context } from 'hono';
import type { z } from '@hono/zod-openapi';
import { ApiError } from './errors';
import type { AppEnv } from './types';

type Issue = z.core.$ZodIssue;

const dotted = (path: PropertyKey[]) => path.map(String).join('.');

/**
 * One Zod issue as the class-validator text Nest's ValidationPipe produced (D5: the CMS shows these).
 * Anything not mapped here (`custom`, refinements) is used verbatim, so a schema that needs an exact
 * Nest message passes it as the issue message.
 */
export function issueMessages(issue: Issue): string[] {
  const p = dotted(issue.path);
  const i = issue as Issue & Record<string, unknown>;
  switch (issue.code) {
    // Nested messages are the child's own text behind its parent path: `translations.0.property x should not exist`.
    case 'unrecognized_keys':
      return (i.keys as string[]).map((k) => `${p ? `${p}.` : ''}property ${k} should not exist`);
    case 'invalid_type':
      return [
        {
          string: `${p} must be a string`,
          number: `${p} must be a number conforming to the specified constraints`,
          int: `${p} must be an integer number`,
          boolean: `${p} must be a boolean value`,
          array: `${p} must be an array`,
          object: `${p} must be an object`,
        }[i.expected as string] ?? `${p} is invalid`,
      ];
    case 'too_small': {
      const min = i.minimum as number | bigint;
      // @MinLength / @Length; no Nest DTO uses @IsNotEmpty.
      if (i.origin === 'string') return [`${p} must be longer than or equal to ${min} characters`];
      if (i.origin === 'array') return [`${p} must contain at least ${min} elements`];
      return [`${p} must not be less than ${min}`];
    }
    case 'too_big': {
      const max = i.maximum as number | bigint;
      if (i.origin === 'string') return [`${p} must be shorter than or equal to ${max} characters`];
      if (i.origin === 'array') return [`${p} must contain no more than ${max} elements`];
      return [`${p} must not be greater than ${max}`];
    }
    case 'invalid_format':
      // @Matches(/x/): Zod's `pattern` is the regex's source form, which is what class-validator prints.
      if (i.format === 'regex') return [`${p} must match ${i.pattern as string} regular expression`];
      return [
        {
          email: `${p} must be an email`,
          uuid: `${p} must be a UUID`,
          url: `${p} must be a URL address`,
        }[i.format as string] ?? `${p} is invalid`,
      ];
    case 'invalid_value':
      return [`${p} must be one of the following values: ${(i.values as unknown[]).join(', ')}`];
    default:
      return [issue.message];
  }
}

/** `defaultHook` for OpenAPIHono: 400 `Validation failed` with the Nest-style `errors` array. */
export function zodHook(result: { success: boolean; error?: z.ZodError }, _c: Context<AppEnv>): void {
  if (result.success || !result.error) return;
  const errors = result.error.issues.flatMap(issueMessages);
  throw new ApiError(400, 'Validation failed', { code: 'VALIDATION_FAILED', errors });
}
