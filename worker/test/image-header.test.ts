import { describe, expect, it } from 'vitest';
import { parseImageHeader, sniffImageMime } from '../src/lib/image-header';
import { images } from './fixtures/images';

describe('parseImageHeader', () => {
  // The variant plan, the row's width/height and the sanitise decision all hang on these answers
  // matching what sharp told Nest.
  it.each(Object.entries(images))('reads %s as sharp did', (_name, { bytes, expected }) => {
    expect(parseImageHeader(bytes)).toEqual(expected);
  });

  it('reads the size from a header-only prefix, as confirm does', () => {
    const { bytes, expected } = images.jpegRotated;
    expect(parseImageHeader(bytes.subarray(0, bytes.length - 200))).toMatchObject({ width: expected.width, height: expected.height });
  });

  it('refuses what is not one of the four raster formats', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<!doctype html><script>alert(1)</script>', '%PDF-1.7', '']) {
      const bytes = new TextEncoder().encode(text);
      expect(parseImageHeader(bytes)).toBeNull();
      expect(sniffImageMime(bytes)).toBeNull();
    }
  });
});
