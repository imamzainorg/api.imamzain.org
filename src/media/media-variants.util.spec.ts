import {
  describeVariants,
  orientedSize,
  plannedWidthsFor,
  VARIANT_PROCESSING_WINDOW_MS,
  VARIANT_WIDTHS,
} from './media-variants.util';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const fresh = new Date(NOW - 10_000);
const stale = new Date(NOW - VARIANT_PROCESSING_WINDOW_MS - 1_000);
const at = (widths: number[]) => widths.map((width) => ({ width }));

describe('plannedWidthsFor', () => {
  it('plans only widths strictly below the original (never up-scales)', () => {
    expect(plannedWidthsFor(1200)).toEqual([320, 768]);
    expect(plannedWidthsFor(1281)).toEqual([320, 768, 1280]);
    expect(plannedWidthsFor(4000)).toEqual([...VARIANT_WIDTHS]);
  });

  it('plans nothing for an original no wider than the smallest width', () => {
    expect(plannedWidthsFor(320)).toEqual([]);
    expect(plannedWidthsFor(100)).toEqual([]);
  });
});

describe('orientedSize', () => {
  it('prefers the size sharp already resolved for the orientation', () => {
    expect(orientedSize({ width: 4000, height: 3000, orientation: 6, autoOrient: { width: 3000, height: 4000 } })).toEqual({
      width: 3000,
      height: 4000,
    });
  });

  it('swaps width and height for the quarter-turn EXIF orientations when autoOrient is absent', () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(orientedSize({ width: 400, height: 200, orientation })).toEqual({ width: 200, height: 400 });
    }
  });

  it('leaves upright and mirrored-only orientations alone', () => {
    for (const orientation of [undefined, 1, 2, 3, 4]) {
      expect(orientedSize({ width: 400, height: 200, orientation })).toEqual({ width: 400, height: 200 });
    }
  });

  it('returns null when there is no usable size', () => {
    expect(orientedSize({})).toBeNull();
    expect(orientedSize({ width: 0, height: 10 })).toBeNull();
  });
});

describe('describeVariants', () => {
  const jpeg = (width: number | null, created_at: Date = fresh) => ({ mime_type: 'image/jpeg', width, created_at });

  it('is ready when every planned width has a variant — a 1200 px cover with 2 rows is complete, not stuck', () => {
    expect(describeVariants(jpeg(1200, stale), at([320, 768]), { now: NOW })).toEqual({
      planned_widths: [320, 768],
      variants_status: 'ready',
    });
  });

  it('is ready with the full set for a large original', () => {
    const info = describeVariants(jpeg(4000, stale), at([320, 768, 1280, 1920]), { now: NOW });
    expect(info.variants_status).toBe('ready');
    expect(info.planned_widths).toEqual([320, 768, 1280, 1920]);
  });

  it('is processing while variants are missing and the row is younger than the window', () => {
    expect(describeVariants(jpeg(1200), [], { now: NOW })).toEqual({
      planned_widths: [320, 768],
      variants_status: 'processing',
    });
    expect(describeVariants(jpeg(1200), at([320]), { now: NOW }).variants_status).toBe('processing');
  });

  it('is partial once the window has passed and variants are still missing', () => {
    expect(describeVariants(jpeg(1200, stale), at([320]), { now: NOW })).toEqual({
      planned_widths: [320, 768],
      variants_status: 'partial',
      variants_status_reason: 'GENERATION_INCOMPLETE',
    });
  });

  it('is unavailable / TOO_SMALL for an original under the smallest width, at any age', () => {
    for (const created_at of [fresh, stale]) {
      expect(describeVariants(jpeg(300, created_at), [], { now: NOW })).toEqual({
        planned_widths: [],
        variants_status: 'unavailable',
        variants_status_reason: 'TOO_SMALL',
      });
    }
  });

  it('is not_applicable for a mime type the pipeline does not handle', () => {
    expect(describeVariants({ mime_type: 'image/svg+xml', width: 800, created_at: stale }, [], { now: NOW })).toEqual({
      planned_widths: [],
      variants_status: 'not_applicable',
      variants_status_reason: 'NON_RASTER',
    });
  });

  it('infers an animated GIF from "no variants after the window", but not while it might still be processing', () => {
    const gif = (created_at: Date) => ({ mime_type: 'image/gif', width: 800, created_at });
    expect(describeVariants(gif(fresh), [], { now: NOW }).variants_status).toBe('processing');
    expect(describeVariants(gif(stale), [], { now: NOW })).toEqual({
      planned_widths: [],
      variants_status: 'not_applicable',
      variants_status_reason: 'ANIMATED',
    });
    // A static GIF that did get variants is just ready.
    expect(describeVariants(gif(stale), at([320, 768]), { now: NOW }).variants_status).toBe('ready');
  });

  it('does not treat a JPEG with no variants after the window as animated', () => {
    expect(describeVariants(jpeg(800, stale), [], { now: NOW }).variants_status).toBe('partial');
  });

  it('with an unknown stored width, trusts the variants that exist instead of demanding all four', () => {
    expect(describeVariants(jpeg(null, stale), at([320, 768]), { now: NOW })).toEqual({
      planned_widths: [320, 768],
      variants_status: 'ready',
    });
  });

  it('with an unknown width and no variants, plans the full set and waits', () => {
    const info = describeVariants(jpeg(null), [], { now: NOW });
    expect(info.planned_widths).toEqual([...VARIANT_WIDTHS]);
    expect(info.variants_status).toBe('processing');
  });

  it('a stale (too small) stored width cannot make an existing variant set look wrong', () => {
    // Row claims 300 px but a 768 variant exists: the variant is evidence, so it is ready.
    expect(describeVariants(jpeg(300, stale), at([320, 768]), { now: NOW }).variants_status).toBe('ready');
  });

  describe('with the outcome of a pass that just ran', () => {
    it('ORIGINAL_MISSING is unavailable even though the row is old and has no variants', () => {
      expect(describeVariants(jpeg(1200, stale), [], { now: NOW, outcome: 'original_missing' })).toEqual({
        planned_widths: [320, 768],
        variants_status: 'unavailable',
        variants_status_reason: 'ORIGINAL_MISSING',
      });
    });

    it('a decode failure is unavailable / UNREADABLE', () => {
      expect(describeVariants(jpeg(1200, stale), [], { now: NOW, outcome: 'unreadable' }).variants_status_reason).toBe('UNREADABLE');
    });

    it('animated is exact: not_applicable / ANIMATED with nothing planned, even on a fresh row', () => {
      expect(describeVariants({ mime_type: 'image/gif', width: 800, created_at: fresh }, [], { now: NOW, outcome: 'animated' })).toEqual({
        planned_widths: [],
        variants_status: 'not_applicable',
        variants_status_reason: 'ANIMATED',
      });
    });

    it('a pass that finished with variants missing is partial at once — never "processing"', () => {
      expect(describeVariants(jpeg(1200, fresh), at([320]), { now: NOW, outcome: 'ok' })).toEqual({
        planned_widths: [320, 768],
        variants_status: 'partial',
        variants_status_reason: 'GENERATION_INCOMPLETE',
      });
    });

    it('a transient storage error leaves the derived answer (partial), not a false "unavailable"', () => {
      expect(describeVariants(jpeg(1200, stale), [], { now: NOW, outcome: 'error' }).variants_status).toBe('partial');
    });

    it('an ok pass on a too-small image reports TOO_SMALL', () => {
      expect(describeVariants(jpeg(200, stale), [], { now: NOW, outcome: 'ok' }).variants_status_reason).toBe('TOO_SMALL');
    });
  });
});
