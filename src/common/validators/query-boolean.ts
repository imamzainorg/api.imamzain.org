/**
 * class-transformer's `@Type(() => Boolean)` does JS `Boolean(value)`, which makes the STRING "false" truthy, and a
 * `value === "true"` transform turns "yes" / "1" / "" into `false` and then APPLIES that filter. Parse query strings
 * explicitly and pass everything else through unchanged so `@IsBoolean()` answers 400.
 */
export const toQueryBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;
