import { Request, Response, NextFunction } from 'express';
import * as zlib from 'zlib';

/**
 * Express middleware that compresses responses with brotli when the client
 * accepts it, gzip otherwise. Replaces the `compression` package because
 * upstream `compression` doesn't support brotli (long-standing open PR) and
 * the established brotli forks (`shrink-ray-current`) pull in a native
 * dependency that doesn't build cleanly on modern Node.
 *
 * Design choices:
 * - Buffer the response body then compress in one shot. The API responses
 *   are all JSON envelopes ≤ tens of KB; streaming compression's complexity
 *   would buy us nothing here. If a future endpoint streams large payloads
 *   it should opt out by setting `Cache-Control: no-transform`.
 * - Brotli quality 4 — the sweet spot for JSON: ~2× the size reduction of
 *   level 1, while costing only ~20% more CPU than level 1 (level 11, the
 *   max, costs ~50× as much CPU for an extra 5% on JSON).
 * - Skip bodies below 1 KB. Compression overhead (headers, framing) erases
 *   the saving on small payloads.
 * - Honour `Cache-Control: no-transform` per RFC 7234.
 */

const MIN_BYTES = 1024;
const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 6;

const COMPRESSIBLE_TYPES = /^(?:text\/|application\/(?:json|javascript|xml|.*\+(?:json|xml)))/i;

type Encoder = 'br' | 'gzip' | 'identity';

function pickEncoder(acceptEncoding: string | undefined): Encoder {
  if (!acceptEncoding) return 'identity';
  // RFC 7231 quality values exist but every modern client sends br/gzip
  // without q-weights; case-insensitive substring match is sufficient.
  const accept = acceptEncoding.toLowerCase();
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return 'identity';
}

function shouldCompress(res: Response): boolean {
  if (res.getHeader('Content-Encoding')) return false; // already encoded by handler
  const cacheControl = String(res.getHeader('Cache-Control') ?? '').toLowerCase();
  if (cacheControl.includes('no-transform')) return false;
  const contentType = String(res.getHeader('Content-Type') ?? '');
  return COMPRESSIBLE_TYPES.test(contentType);
}

function encode(body: Buffer, encoder: Encoder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (encoder === 'br') {
      zlib.brotliCompress(
        body,
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    } else if (encoder === 'gzip') {
      zlib.gzip(body, { level: GZIP_LEVEL }, (err, out) => (err ? reject(err) : resolve(out)));
    } else {
      resolve(body);
    }
  });
}

export function smartCompression() {
  return (req: Request, res: Response, next: NextFunction) => {
    const encoder = pickEncoder(req.headers['accept-encoding'] as string | undefined);
    if (encoder === 'identity') return next();

    // Buffer writes until end() so we can decide whether to compress based
    // on the final size and headers.
    const chunks: Buffer[] = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    const push = (chunk: unknown, encodingArg?: BufferEncoding) => {
      if (chunk === null || chunk === undefined) return;
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, encodingArg ?? 'utf8'));
      else chunks.push(Buffer.from(String(chunk), encodingArg ?? 'utf8'));
    };

    // The Express types overload .write/.end heavily — cast through any so we
    // can normalise both forms into our buffer push without re-declaring
    // four signatures.
    (res as any).write = (chunk: any, encoding?: any, cb?: any): boolean => {
      const enc = typeof encoding === 'string' ? (encoding as BufferEncoding) : undefined;
      push(chunk, enc);
      if (typeof encoding === 'function') encoding();
      else if (typeof cb === 'function') cb();
      return true;
    };

    (res as any).end = (chunk?: any, encoding?: any, cb?: any) => {
      if (chunk) {
        const enc = typeof encoding === 'string' ? (encoding as BufferEncoding) : undefined;
        push(chunk, enc);
      }
      const callback = typeof encoding === 'function' ? encoding : cb;

      const body = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
      const finish = (out: Buffer, contentEncoding: Encoder) => {
        if (contentEncoding !== 'identity') {
          res.setHeader('Content-Encoding', contentEncoding);
          // ETag based on the original content shouldn't carry through after
          // a transformative encoding — drop it so a downstream cache doesn't
          // serve gzipped bytes against a brotli ETag (per RFC 7232 §2.3).
          res.removeHeader('ETag');
        }
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', out.length);
        if (callback) origEnd(out, callback);
        else origEnd(out);
      };

      if (body.length < MIN_BYTES || !shouldCompress(res)) {
        return finish(body, 'identity');
      }

      encode(body, encoder).then(
        (compressed) => finish(compressed, encoder),
        () => finish(body, 'identity'), // graceful fallback on compress error
      );
      return res;
    };

    next();
  };
}
