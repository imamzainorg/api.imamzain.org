import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AudioAdminQueryDto } from '../../audios/dto/audio.dto';
import { BookQueryDto } from '../../books/dto/book.dto';
import { AttemptQueryDto } from '../../contest/dto/contest.dto';
import { SubscriberQueryDto } from '../../newsletter/dto/newsletter.dto';
import { PostQueryDto } from '../../posts/dto/post.dto';
import { StaticPageQueryDto } from '../../static-pages/dto/static-page.dto';
import { toQueryBoolean } from './query-boolean';

type Ctor = new () => object;

// Every list DTO that takes a boolean query parameter, with the parameter's name.
const BOOLEAN_QUERY_DTOS: Array<[string, Ctor, string]> = [
  ['PostQueryDto', PostQueryDto, 'featured'],
  ['AudioAdminQueryDto', AudioAdminQueryDto, 'is_published'],
  ['StaticPageQueryDto', StaticPageQueryDto, 'is_published'],
  ['BookQueryDto', BookQueryDto, 'is_publication'],
  ['AttemptQueryDto', AttemptQueryDto, 'submitted'],
  ['SubscriberQueryDto', SubscriberQueryDto, 'is_active'],
];

async function failingProperties(cls: Ctor, plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain) as object, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe('toQueryBoolean', () => {
  it.each([
    ['true', true],
    [true, true],
    ['false', false],
    [false, false],
  ])('turns %p into %p', (input, expected) => {
    expect(toQueryBoolean({ value: input })).toBe(expected);
  });

  // Anything else is handed on unchanged so @IsBoolean() can answer 400.
  it.each(['yes', 'no', '1', '0', '', 'TRUE', 'False', 'on', ' true', undefined, null, 1, ['true']])('leaves %p alone', (input) => {
    expect(toQueryBoolean({ value: input })).toBe(input);
  });
});

describe.each(BOOLEAN_QUERY_DTOS)('%s', (_name, cls, field) => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses %p to a real boolean', async (raw, expected) => {
    const dto = plainToInstance(cls, { [field]: raw }) as Record<string, unknown>;
    expect(dto[field]).toBe(expected);
    expect(await failingProperties(cls, { [field]: raw })).toEqual([]);
  });

  it('accepts the parameter being absent', async () => {
    expect(await failingProperties(cls, {})).toEqual([]);
  });

  // The old transforms turned these into `false` and then applied that filter.
  it.each(['yes', 'no', '1', '0', '', 'TRUE', 'on'])('rejects %p with a validation error instead of filtering on false', async (raw) => {
    expect(await failingProperties(cls, { [field]: raw })).toContain(field);
  });

  it('rejects the parameter being repeated', async () => {
    expect(await failingProperties(cls, { [field]: ['true', 'false'] })).toContain(field);
  });
});
