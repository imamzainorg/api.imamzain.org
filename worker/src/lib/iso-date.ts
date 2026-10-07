import { z } from '@hono/zod-openapi';

// validator.js's isISO8601 (non-strict), which class-validator's @IsDateString uses.
const ISO_8601 =
  /^([+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24:?00)([.,]\d+(?!:))?)?(\17[0-5]\d([.,]\d+)?)?([zZ]|([+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$/;

export const isoDate = (field: string) =>
  z.custom<string>((v) => typeof v === 'string' && ISO_8601.test(v), `${field} must be a valid ISO 8601 date string`);
