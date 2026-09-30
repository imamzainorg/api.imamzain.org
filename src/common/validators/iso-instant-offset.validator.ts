import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

// An ISO-8601 instant that says which time zone it is in. Without this a value
// such as "2026-06-01T09:00:00" is read in the SERVER's zone (UTC), so an
// editor in Baghdad (UTC+3) schedules a post that goes live three hours late.
export const ISO_INSTANT_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * `new Date()` silently rolls an impossible day over ("2026-02-31" becomes
 * 3 March, "T24:00" the next midnight), so the components are checked rather
 * than trusting the parse.
 */
export function isIsoInstantWithOffset(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = ISO_INSTANT_WITH_OFFSET.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

/** Validate an ISO-8601 timestamp that carries an explicit UTC offset (`Z` or `+hh:mm`). */
export function IsIsoInstantWithOffset(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsIsoInstantWithOffset',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isIsoInstantWithOffset(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-06-01T09:00:00Z or 2026-06-01T12:00:00+03:00`,
      },
    });
  };
}
