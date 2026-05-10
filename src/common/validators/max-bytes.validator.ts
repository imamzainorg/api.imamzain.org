import { registerDecorator, ValidationOptions } from 'class-validator';
import { MAX_BODY_BYTES, utf8ByteLength } from '../utils/html-sanitize.util';

/**
 * Validate that a string's UTF-8 byte length does not exceed `max`.
 *
 * `MaxLength` from class-validator counts JS string length (UTF-16 code
 * units), which is misleading for non-Latin content — a 2-byte UTF-8
 * character counts as 1 code unit, so `MaxLength(N)` over-allows on
 * Arabic / CJK content while under-allowing on emoji. This validator
 * matches what the JSON parser actually receives on the wire and matches
 * the CMS's client-side `byteLength` cap.
 */
export function MaxBytes(max: number = MAX_BODY_BYTES, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'MaxBytes',
      target: object.constructor,
      propertyName,
      options,
      constraints: [max],
      validator: {
        validate(value: unknown, args) {
          if (typeof value !== 'string') return false;
          const limit = args.constraints[0] as number;
          return utf8ByteLength(value) <= limit;
        },
        defaultMessage(args) {
          const limit = args.constraints[0] as number;
          return `${args.property} must be at most ${limit} bytes (UTF-8)`;
        },
      },
    });
  };
}
