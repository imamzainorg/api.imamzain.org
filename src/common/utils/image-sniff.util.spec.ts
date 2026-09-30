import { sniffImageMime } from './image-sniff.util';

describe('sniffImageMime', () => {
  it('recognises JPEG', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toBe('image/jpeg');
  });

  it('recognises PNG', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
  });

  it('recognises GIF87a and GIF89a', () => {
    expect(sniffImageMime(Buffer.from('GIF87a\x01\x00'))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from('GIF89a\x01\x00'))).toBe('image/gif');
  });

  it('recognises WebP (RIFF....WEBP)', () => {
    expect(sniffImageMime(Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects HTML, SVG, PDF, RIFF-but-not-WebP and empty input', () => {
    expect(sniffImageMime(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageMime(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImageMime(Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt '))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });

  it('rejects a truncated signature', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
