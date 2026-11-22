import { describe, expect, it } from 'vitest';
import { contentDispositionFor, mediaIdFromKey } from '../src/lib/r2';

const ID = '3f2b8c1e-9d4a-4c55-8e1f-0a2b3c4d5e6f';

describe('mediaIdFromKey', () => {
  // Catches: confirm minting a new media id for a flat key, so the original and its variants end up under different ids.
  it('reads the id from the flat key and from the older originals/ key, and from no other', () => {
    expect(mediaIdFromKey(`media/${ID}.png`)).toBe(ID);
    expect(mediaIdFromKey(`media/originals/${ID}/photo.png`)).toBe(ID);
    expect(mediaIdFromKey(`media/variants/${ID}/w320.webp`)).toBeNull();
    expect(mediaIdFromKey('media/originals/legacy-name/photo.png')).toBeNull();
    expect(mediaIdFromKey(`books/pdf/${ID}.pdf`)).toBeNull();
  });
});

describe('contentDispositionFor', () => {
  // Catches: Arabic names collapsing to "file.pdf" again, or a non-ASCII byte in a signed header (the PUT would fail).
  it('keeps the readable name, Arabic included, as an ASCII RFC 5987 header', () => {
    const header = contentDispositionFor('الصحيفة السجادية.PDF', 'pdf');
    expect(header).toBe(`inline; filename*=UTF-8''${encodeURIComponent('الصحيفة السجادية.pdf')}`);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(header.split("''")[1])).toBe('الصحيفة السجادية.pdf');
  });

  // Catches: a quote or paren in a title breaking the header, or a client path leaking into the download name.
  it('encodes the characters RFC 5987 reserves and drops any path and control characters', () => {
    expect(contentDispositionFor("C:\\scans\\Imam's (draft)*.jpeg", 'jpg')).toBe(
      "inline; filename*=UTF-8''Imam%27s%20%28draft%29%2A.jpg",
    );
    expect(contentDispositionFor('\u0001\n', 'mp3')).toBe("inline; filename*=UTF-8''file.mp3");
  });
});
