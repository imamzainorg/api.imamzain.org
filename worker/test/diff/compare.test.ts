import { describe, expect, it } from 'vitest';
import { compare, IdMap, type Captured, type CompareContext } from './compare';

const runStart = Date.parse('2026-10-04T10:00:00Z');
const ctx = (over: Partial<CompareContext> = {}): CompareContext => ({ ids: new IdMap(), runStart, allowNewIds: false, ...over });
const json = (body: unknown, over: Partial<Captured> = {}): Captured => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  etag: 'W/"x"',
  body: JSON.stringify(body),
  ...over,
});

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const NOW_A = '2026-10-04T10:00:01.000Z';
const NOW_B = '2026-10-04T10:00:02.500Z';
const OLD = '2025-01-01T00:00:00.000Z';

describe('compare', () => {
  it('ignores the envelope timestamp and the error requestId', () => {
    expect(compare(json({ success: true, timestamp: NOW_A }), json({ success: true, timestamp: OLD }), ctx())).toEqual([]);
    // Error envelopes: requestId and the mid-body timestamp make their ETags differ on every request.
    expect(compare(json({ success: false, requestId: 7 }), json({ success: false, requestId: ID_B }, { etag: 'W/"y"' }), ctx())).toEqual([]);
  });

  it('reports status, content-type and body fields by path', () => {
    const diffs = compare(json({ data: { n: 1, s: 'a' } }), json({ data: { n: 2, s: 'a' } }, { status: 404, contentType: 'application/json' }), ctx());
    expect(diffs.map((d) => d.field)).toEqual(['status', 'content-type', '$.data.n']);
  });

  it('reports missing keys, array length and key order', () => {
    const diffs = compare(json({ a: 1, b: [1, 2], c: 1 }), json({ b: [1], a: 1, d: 1 }), ctx());
    expect(diffs.map((d) => d.field)).toEqual(['$.b.length', '$.c', '$.d', '$ (key order)']);
    expect(diffs[1]).toMatchObject({ a: '1', b: '<missing>' });
  });

  it('treats dates generated during the run as equal, but not older ones', () => {
    expect(compare(json({ at: NOW_A }), json({ at: NOW_B }), ctx())).toEqual([]);
    expect(compare(json({ at: OLD }), json({ at: NOW_B }), ctx())).toHaveLength(1);
  });

  it('pairs new ids only when allowed, and holds every later response to the pairing', () => {
    const ids = new IdMap();
    expect(compare(json({ id: ID_A }), json({ id: ID_B }), ctx({ ids }))).toHaveLength(1);

    const write = ctx({ ids, allowNewIds: true });
    expect(compare(json({ id: ID_A, path: `/x/${ID_A}` }), json({ id: ID_B, path: `/x/${ID_B}` }), write)).toEqual([]);
    expect(ids.toB(ID_A)).toBe(ID_B);
    // A later read must keep A↔B, and C can't stand in for B.
    expect(compare(json({ id: ID_A }), json({ id: ID_B }), ctx({ ids }))).toEqual([]);
    expect(compare(json({ id: ID_A }), json({ id: ID_C }), write)).toHaveLength(1);
  });

  it('does not pair ids when the rest of the string differs', () => {
    const ids = new IdMap();
    expect(compare(json({ p: `/a/${ID_A}` }), json({ p: `/b/${ID_B}` }), ctx({ ids, allowNewIds: true }))).toHaveLength(1);
    expect(ids.toB(ID_A)).toBeUndefined();
  });

  it('requires equal ETags for identical content, and skips them when ids or dates were normalized', () => {
    expect(compare(json({ a: 1 }), json({ a: 1 }, { etag: 'W/"y"' }), ctx())).toEqual([{ field: 'etag', a: '"W/\\"x\\""', b: '"W/\\"y\\""' }]);
    expect(compare(json({ at: NOW_A }), json({ at: NOW_B }, { etag: 'W/"y"' }), ctx())).toEqual([]);
  });

  it('compares non-JSON bodies as text and names the first differing line', () => {
    const xml = (d: string, t: string) => ({ status: 200, contentType: 'application/xml', etag: null, body: `<a>\n<lastmod>${d}</lastmod>\n<t>${t}</t>\n</a>` });
    expect(compare(xml(NOW_A, 'x'), xml(NOW_B, 'x'), ctx())).toEqual([]);
    expect(compare(xml(OLD, 'x'), xml(OLD, 'y'), ctx())).toEqual([{ field: 'body line 3', a: '"<t>x</t>"', b: '"<t>y</t>"' }]);
  });
});
