import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCampaignDto, UpdateCampaignDto } from '../../newsletter/dto/campaign.dto';
import { CreatePostDto, UpdatePostDto } from '../../posts/dto/post.dto';
import { isIsoInstantWithOffset } from './iso-instant-offset.validator';

type Ctor = new () => object;

const VALID = [
  '2026-06-01T09:00:00Z',
  '2026-06-01T09:00Z',
  '2026-06-01T09:00:00.123Z',
  '2026-06-01T09:00:00.123456789Z',
  '2026-06-01T12:00:00+03:00',
  '2026-06-01T12:00+03:00',
  '2026-06-01T04:30:00-05:30',
  '2028-02-29T00:00:00Z',
];

const INVALID: Array<[string, string]> = [
  ['no offset at all (would be read in server time)', '2026-06-01T09:00:00'],
  ['no offset, no seconds', '2026-06-01T09:00'],
  ['date only', '2026-06-01'],
  ['space instead of T', '2026-06-01 09:00:00Z'],
  ['lowercase z', '2026-06-01T09:00:00z'],
  ['offset without a colon', '2026-06-01T12:00:00+0300'],
  ['hour-only offset', '2026-06-01T12:00:00+03'],
  ['impossible day', '2026-02-31T09:00:00Z'],
  ['29 February in a non-leap year', '2027-02-29T09:00:00Z'],
  ['month 13', '2026-13-01T09:00:00Z'],
  ['hour 24', '2026-06-01T24:00:00Z'],
  ['minute 60', '2026-06-01T09:60:00Z'],
  ['second 60', '2026-06-01T09:00:60Z'],
  ['offset hour 25', '2026-06-01T09:00:00+25:00'],
  ['offset minute 60', '2026-06-01T09:00:00+03:60'],
  ['free text', 'next tuesday'],
  ['empty string', ''],
];

describe('isIsoInstantWithOffset', () => {
  it.each(VALID)('accepts %s', (value) => {
    expect(isIsoInstantWithOffset(value)).toBe(true);
  });

  it.each(INVALID)('rejects %s', (_why, value) => {
    expect(isIsoInstantWithOffset(value)).toBe(false);
  });

  it.each([[undefined], [null], [20260601], [new Date()], [{}]])('rejects the non-string %p', (value) => {
    expect(isIsoInstantWithOffset(value)).toBe(false);
  });
});

// [DTO, property, base payload]
const SCHEDULED_FIELDS: Array<[string, Ctor, string, Record<string, unknown>]> = [
  [
    'CreatePostDto.published_at',
    CreatePostDto,
    'published_at',
    { category_id: '00000000-0000-4000-8000-000000000001', slug: 'a-post', translations: [{ lang: 'ar', title: 'T', body: '<p>b</p>', is_default: true }] },
  ],
  ['UpdatePostDto.published_at', UpdatePostDto, 'published_at', {}],
  ['CreateCampaignDto.scheduled_at', CreateCampaignDto, 'scheduled_at', { subject: 's', body_html: '<p>x</p>' }],
  ['UpdateCampaignDto.scheduled_at', UpdateCampaignDto, 'scheduled_at', {}],
];

async function failingProperties(cls: Ctor, plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain) as object, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe.each(SCHEDULED_FIELDS)('%s', (_name, cls, field, base) => {
  it.each(VALID)('accepts %s', async (value) => {
    expect(await failingProperties(cls, { ...base, [field]: value })).toEqual([]);
  });

  it.each(INVALID)('rejects %s', async (_why, value) => {
    expect(await failingProperties(cls, { ...base, [field]: value })).toContain(field);
  });

  it('may be omitted', async () => {
    expect(await failingProperties(cls, base)).toEqual([]);
  });

  it('names the property and shows an example with an offset in the error', async () => {
    const [error] = await validate(plainToInstance(cls, { ...base, [field]: '2026-06-01T09:00:00' }) as object);
    const message = Object.values(error.constraints ?? {}).join(' ');
    expect(message).toContain(field);
    expect(message).toMatch(/offset/i);
  });
});

describe('null clears a schedule', () => {
  it.each([
    ['UpdatePostDto.published_at', UpdatePostDto, 'published_at'],
    ['UpdateCampaignDto.scheduled_at', UpdateCampaignDto, 'scheduled_at'],
  ])('%s accepts null', async (_name, cls, field) => {
    expect(await failingProperties(cls as Ctor, { [field]: null })).toEqual([]);
  });
});
