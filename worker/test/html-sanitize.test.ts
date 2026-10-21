import { describe, expect, it } from 'vitest';
import { sanitizeEditorHtml } from '../src/lib/html-sanitize';

describe('sanitizeEditorHtml', () => {
  it('strips <style> tags', () => {
    expect(sanitizeEditorHtml('<style>body{display:none}</style><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('strips javascript: in href', () => {
    const cleaned = sanitizeEditorHtml('<a href="javascript:alert(1)">x</a>');
    expect(cleaned).not.toContain('javascript:');
  });

  it('strips javascript: in src', () => {
    const cleaned = sanitizeEditorHtml('<img src="javascript:alert(1)" alt="x">');
    expect(cleaned).not.toContain('javascript:');
  });

  it('strips vbscript: in href', () => {
    const cleaned = sanitizeEditorHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(cleaned).not.toContain('vbscript:');
  });

  it('rejects data: in href (potential HTML payload)', () => {
    const cleaned = sanitizeEditorHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(cleaned).not.toContain('data:');
  });

  it('allows data:image/* in img src', () => {
    const html =
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" alt="x">';
    expect(sanitizeEditorHtml(html)).toContain('data:image/png');
  });

  it('rejects non-image data: MIME types in <img src>', () => {
    const cleaned = sanitizeEditorHtml('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">');
    // The whole <img> element is dropped because the data: MIME is not in
    // the image allowlist; sanitize-html drops the element wholesale.
    expect(cleaned).not.toContain('data:text/html');
    expect(cleaned).not.toContain('<img');
  });

  it('strips style attribute (potential CSS-based injection)', () => {
    const cleaned = sanitizeEditorHtml('<p style="background:url(javascript:alert(1))">x</p>');
    expect(cleaned).not.toContain('style');
    expect(cleaned).not.toContain('javascript:');
  });
});

describe('sanitizeEditorHtml — link targets', () => {
  const rel = 'rel="noopener noreferrer"';

  it.each(['_blank', '_BLANK', '_Blank', ' _blank ', '\t_blank\n'])(
    'normalises target %j to _blank and forces rel on it',
    (target) => {
      const cleaned = sanitizeEditorHtml(`<a href="https://example.com" target="${target}">x</a>`);
      expect(cleaned).toContain('target="_blank"');
      expect(cleaned).toContain(rel);
    },
  );

  it('overwrites an authored rel that would leave the opener reachable', () => {
    const cleaned = sanitizeEditorHtml('<a href="https://example.com" target="_blank" rel="opener">x</a>');
    expect(cleaned).toContain(rel);
    expect(cleaned).not.toContain('opener"');
  });

  it('overwrites a partial rel (noopener alone) so noreferrer is always present', () => {
    const cleaned = sanitizeEditorHtml('<a href="https://example.com" target="_blank" rel="noopener">x</a>');
    expect(cleaned).toContain(rel);
  });

  it('is not fooled by an upper-case attribute name', () => {
    const cleaned = sanitizeEditorHtml('<a href="https://example.com" TARGET="_BLANK">x</a>');
    expect(cleaned).toContain('target="_blank"');
    expect(cleaned).toContain(rel);
  });

  it.each(['_top', '_self', '_parent', 'popup', '_blank2', ''])(
    'drops target %j — only _blank survives',
    (target) => {
      const cleaned = sanitizeEditorHtml(`<a href="https://example.com" target="${target}">x</a>`);
      expect(cleaned).not.toContain('target');
    },
  );

  it('leaves an anchor without a target alone, including its rel', () => {
    const cleaned = sanitizeEditorHtml('<a href="https://example.com" rel="nofollow">x</a>');
    expect(cleaned).toBe('<a href="https://example.com" rel="nofollow">x</a>');
  });
});

describe('sanitizeEditorHtml — ids', () => {
  it('neutralises the classic DOM-clobbering names by prefixing them', () => {
    const cleaned = sanitizeEditorHtml('<img id="__next" src="https://example.com/a.png"><p id="location">x</p>');
    // "__next" starts with an underscore, so it is dropped; "location" becomes
    // a harmless prefixed id instead of shadowing window.location.
    expect(cleaned).not.toContain(' id="__next"');
    expect(cleaned).not.toContain(' id="location"');
    expect(cleaned).toContain('id="user-content-location"');
  });

  it.each([
    ['starts with a digit', '1abc'],
    ['starts with an underscore', '_x'],
    ['contains a space', 'a b'],
    ['contains a dot', 'a.b'],
    ['contains a colon', 'a:b'],
    ['is 65 characters long', 'a'.repeat(65)],
    ['is empty after the prefix', 'user-content-'],
    ['is only the prefix plus an invalid start', 'user-content-9'],
  ])('drops an id that %s', (_label, id) => {
    const cleaned = sanitizeEditorHtml(`<p id="${id}">x</p>`);
    expect(cleaned).toBe('<p>x</p>');
  });

  it('keeps a 64-character id', () => {
    const id = 'a'.repeat(64);
    expect(sanitizeEditorHtml(`<p id="${id}">x</p>`)).toBe(`<p id="user-content-${id}">x</p>`);
  });

  it('is idempotent: re-sanitising a body the CMS fetched and re-saved does not stack prefixes', () => {
    const once = sanitizeEditorHtml('<h2 id="intro">Intro</h2><a href="#intro">up</a>');
    expect(sanitizeEditorHtml(once)).toBe(once);
    expect(once).toBe('<h2 id="user-content-intro">Intro</h2><a href="#user-content-intro">up</a>');
  });

  it('rewrites a fragment even when the link carries leading whitespace', () => {
    expect(sanitizeEditorHtml('<a href=" #intro">x</a>')).toContain('href="#user-content-intro"');
  });

  it('leaves a bare "#" and external URLs with fragments untouched', () => {
    expect(sanitizeEditorHtml('<a href="#">top</a>')).toBe('<a href="#">top</a>');
    expect(sanitizeEditorHtml('<a href="https://example.com/page#intro">x</a>')).toBe(
      '<a href="https://example.com/page#intro">x</a>',
    );
  });

  it('does not rewrite a fragment that is not a valid id shape', () => {
    expect(sanitizeEditorHtml('<a href="#1st">x</a>')).toBe('<a href="#1st">x</a>');
  });
});
