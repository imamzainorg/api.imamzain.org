import { z } from '@hono/zod-openapi';

// @Transform(toQueryBoolean): only the strings true/false are parsed; anything else reaches @IsBoolean.
export const queryBoolean = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());
