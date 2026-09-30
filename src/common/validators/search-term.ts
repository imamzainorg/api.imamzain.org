import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 200;

/** Trim a string; leave anything else for the type validator to reject. */
export const toTrimmedString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// A blank box is "no search", not a one-character search — a CMS that sends
// `?search=` when the field is cleared must keep listing everything.
const toSearchTerm = ({ value }: { value: unknown }): unknown => {
  const trimmed = toTrimmedString({ value });
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Optional list `?search=` parameter: trimmed, blank means absent, otherwise
 * 2–200 characters. A one-character `contains` term cannot use the trigram
 * indexes and scans every body/abstract.
 */
export function SearchTerm(): PropertyDecorator {
  return applyDecorators(
    Transform(toSearchTerm),
    IsOptional(),
    IsString(),
    MinLength(SEARCH_MIN_LENGTH),
    MaxLength(SEARCH_MAX_LENGTH),
  );
}
