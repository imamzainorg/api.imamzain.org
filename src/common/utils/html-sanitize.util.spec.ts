import { sanitizeEditorHtml, utf8ByteLength, MAX_BODY_BYTES } from './html-sanitize.util';

describe('sanitizeEditorHtml', () => {
  it('keeps allowed tags untouched', () => {
    const html = '<p>Hello <strong>world</strong></p><h1>Title</h1>';
    expect(sanitizeEditorHtml(html)).toBe(html);
  });

  it('strips <script> tags', () => {
    expect(sanitizeEditorHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });

  it('strips <style> tags', () => {
    expect(sanitizeEditorHtml('<style>body{display:none}</style><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('strips inline event handlers', () => {
    const cleaned = sanitizeEditorHtml('<p onclick="alert(1)">x</p>');
    expect(cleaned).not.toContain('onclick');
    expect(cleaned).toContain('<p>x</p>');
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

  it('adds rel=noopener noreferrer to target=_blank links', () => {
    const cleaned = sanitizeEditorHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(cleaned).toMatch(/rel="noopener noreferrer"/);
  });

  it('allows class attribute on Tiptap output', () => {
    expect(sanitizeEditorHtml('<pre class="hljs"><code>x</code></pre>')).toContain('class="hljs"');
  });

  it('strips style attribute (potential CSS-based injection)', () => {
    const cleaned = sanitizeEditorHtml('<p style="background:url(javascript:alert(1))">x</p>');
    expect(cleaned).not.toContain('style');
    expect(cleaned).not.toContain('javascript:');
  });

  it('preserves table structure', () => {
    const html = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    expect(sanitizeEditorHtml(html)).toBe(html);
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(sanitizeEditorHtml(null)).toBe('');
    expect(sanitizeEditorHtml(undefined)).toBe('');
    expect(sanitizeEditorHtml('')).toBe('');
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
  it('namespaces a kept id', () => {
    expect(sanitizeEditorHtml('<h2 id="intro">Intro</h2>')).toBe('<h2 id="user-content-intro">Intro</h2>');
  });

  it('namespaces ids on any allowed tag, not only headings', () => {
    const cleaned = sanitizeEditorHtml('<div id="box"><p id="para_1">x</p></div>');
    expect(cleaned).toBe('<div id="user-content-box"><p id="user-content-para_1">x</p></div>');
  });

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

  it('rewrites same-page href="#x" anchors so in-page links keep working', () => {
    const cleaned = sanitizeEditorHtml('<a href="#intro">jump</a><h2 id="intro">Intro</h2>');
    expect(cleaned).toBe('<a href="#user-content-intro">jump</a><h2 id="user-content-intro">Intro</h2>');
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

  it('keeps the existing class attribute and combines with an id', () => {
    expect(sanitizeEditorHtml('<pre class="hljs" id="code1"><code>x</code></pre>')).toBe(
      '<pre class="hljs" id="user-content-code1"><code>x</code></pre>',
    );
  });
});

describe('utf8ByteLength', () => {
  it('counts ASCII as 1 byte each', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts Arabic as 2 bytes per character', () => {
    expect(utf8ByteLength('السلام')).toBe(12);
  });

  it('matches MAX_BODY_BYTES export', () => {
    expect(MAX_BODY_BYTES).toBe(200 * 1024);
  });
});
