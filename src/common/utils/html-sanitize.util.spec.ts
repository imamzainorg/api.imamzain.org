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
