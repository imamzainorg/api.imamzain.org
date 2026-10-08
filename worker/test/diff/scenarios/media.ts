import type { Scenario } from '../scenario';

const BASE = '/api/v1/media';

export default [
  {
    name: 'upload-and-edit',
    steps: [
      { method: 'POST', path: `${BASE}/upload-url`, body: { filename: 'Diff Photo.png', mime_type: 'image/png' }, capture: { key: 'data.key' } },
      { method: 'POST', path: `${BASE}/upload-url`, body: { filename: 'x.svg', mime_type: 'image/svg+xml' } },
      // Never uploaded: the 400 both sides give before any image work.
      { method: 'POST', path: `${BASE}/confirm`, body: { key: '{{key}}', filename: 'diff.png', mime_type: 'image/png', file_size: 10 } },
      { method: 'POST', path: `${BASE}/confirm`, body: { key: 'posts/x.png', filename: 'diff.png', mime_type: 'image/png', file_size: 10 } },
      { method: 'GET', path: `${BASE}?limit=1`, capture: { media: 'data.items.0.id' } },
      { method: 'PATCH', path: `${BASE}/{{media}}`, body: { alt_text: 'diff alt text' } },
      { method: 'GET', path: `${BASE}/{{media}}/references` },
      { method: 'GET', path: `${BASE}?search=diff alt` },
      { method: 'POST', path: '/api/v1/books/upload-url', body: { filename: 'book.pdf' } },
    ],
  },
] satisfies Scenario[];
