import * as http from 'http';
import { AddressInfo } from 'net';
import * as zlib from 'zlib';
import express from 'express';
import { lastValueFrom, of } from 'rxjs';
import { smartCompression } from '../middleware/compression.middleware';
import { envelopeEtag, ResponseInterceptor } from './response.interceptor';

const envelope = (data: unknown, timestamp: string) =>
  JSON.stringify({ message: 'ok', data, success: true, timestamp });

describe('envelopeEtag', () => {
  it('is a weak validator', () => {
    expect(envelopeEtag(Buffer.from(envelope({ a: 1 }, '2026-09-24T10:00:00.000Z')))).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
  });

  it('is the same for two responses that differ only in the envelope timestamp', () => {
    const first = envelopeEtag(Buffer.from(envelope({ a: 1 }, '2026-09-24T10:00:00.000Z')));
    const second = envelopeEtag(Buffer.from(envelope({ a: 1 }, '2026-09-24T10:00:07.123Z')));

    expect(second).toBe(first);
  });

  it('changes when the payload changes', () => {
    const ts = '2026-09-24T10:00:00.000Z';

    expect(envelopeEtag(Buffer.from(envelope({ a: 1 }, ts)))).not.toBe(envelopeEtag(Buffer.from(envelope({ a: 2 }, ts))));
  });

  it('does not ignore a timestamp field that is part of the data', () => {
    const wrap = (inner: string) => `{"data":{"timestamp":"${inner}","x":1},"success":true,"timestamp":"2026-09-24T10:00:00.000Z"}`;

    expect(envelopeEtag(Buffer.from(wrap('2026-01-01T00:00:00.000Z')))).not.toBe(envelopeEtag(Buffer.from(wrap('2026-02-02T00:00:00.000Z'))));
  });

  it('hashes the whole body when there is no trailing envelope timestamp (XML, files)', () => {
    const xml = '<urlset><url><loc>https://imamzain.org/</loc></url></urlset>';

    expect(envelopeEtag(Buffer.from(xml))).toBe(envelopeEtag(Buffer.from(xml)));
    expect(envelopeEtag(Buffer.from(xml))).not.toBe(envelopeEtag(Buffer.from(xml.replace('imamzain', 'example'))));
  });

  it('gives a string and the same bytes as a Buffer the same validator', () => {
    const body = envelope({ a: 1 }, '2026-09-24T10:00:00.000Z');

    expect(envelopeEtag(body)).toBe(envelopeEtag(Buffer.from(body)));
  });
});

describe('conditional GET through the envelope, envelopeEtag and smartCompression', () => {
  let server: http.Server;
  let port: number;
  let items: number[];

  beforeAll(async () => {
    const interceptor = new ResponseInterceptor();
    const app = express();
    app.set('etag', envelopeEtag);
    app.use(smartCompression());
    // Same envelope the real interceptor builds, so the timestamp is genuinely new on every request.
    app.get('/big', async (_req, res) => {
      const body = await lastValueFrom(interceptor.intercept({} as never, { handle: () => of({ message: 'ok', data: { items } }) }));
      res.json(body);
    });
    app.get('/small', async (_req, res) => {
      const body = await lastValueFrom(interceptor.intercept({} as never, { handle: () => of({ message: 'ok', data: { n: items.length } }) }));
      res.json(body);
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    items = Array.from({ length: 400 }, (_, i) => i);
  });

  function get(path: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path, headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode as number, headers: res.headers, body: Buffer.concat(chunks) }));
        })
        .on('error', reject);
    });
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('answers 304 to a matching If-None-Match on a compressed (>1 KB) response', async () => {
    const first = await get('/big', { 'accept-encoding': 'gzip' });
    const etag = first.headers.etag as string;

    expect(first.status).toBe(200);
    expect(first.headers['content-encoding']).toBe('gzip');
    expect(etag).toMatch(/^W\//);

    await sleep(5); // the envelope timestamp is different on the next response
    const second = await get('/big', { 'accept-encoding': 'gzip', 'if-none-match': etag });

    expect(second.status).toBe(304);
    expect(second.body.length).toBe(0);
    expect(second.headers.etag).toBe(etag);
    expect(second.headers['content-length']).toBeUndefined();
  });

  it('answers 304 on a small identity response too', async () => {
    const first = await get('/small');
    await sleep(5);
    const second = await get('/small', { 'if-none-match': first.headers.etag as string });

    expect(first.status).toBe(200);
    expect(second.status).toBe(304);
  });

  it('still sends the full body, with a fresh timestamp, when the validator does not match', async () => {
    const first = await get('/big', { 'accept-encoding': 'gzip' });
    items = [...items, 9999];
    await sleep(5);
    const second = await get('/big', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag as string });

    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    const a = JSON.parse(zlib.gunzipSync(first.body).toString());
    const b = JSON.parse(zlib.gunzipSync(second.body).toString());
    expect(a.success).toBe(true);
    expect(b.timestamp).toEqual(expect.any(String));
    expect(b.timestamp).not.toBe(a.timestamp);
    expect(b.data.items).toHaveLength(401);
  });

  it('leaves the response body untouched: same fields, timestamp last', async () => {
    const res = await get('/small');
    const parsed = JSON.parse(res.body.toString());

    expect(Object.keys(parsed)).toEqual(['message', 'data', 'success', 'timestamp']);
  });
});
