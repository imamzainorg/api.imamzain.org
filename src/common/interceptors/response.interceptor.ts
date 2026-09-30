import { createHash } from 'crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const TIMESTAMP_KEY = Buffer.from(',"timestamp":"');
const TIMESTAMP_TAIL = /^,"timestamp":"[^"]{1,40}"}$/;

/**
 * Express ETag function (`app.set('etag', envelopeEtag)`). The envelope's `timestamp` is its last key and
 * differs on every response, so Express's default body hash never matched an If-None-Match and no request could
 * ever be answered 304. Hashing the body without that one trailing field gives an unchanged payload a stable
 * weak validator. Only the ETag header changes; the body sent is byte-for-byte what it was.
 */
export function envelopeEtag(body: Buffer | string): string {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  const at = buf.lastIndexOf(TIMESTAMP_KEY);
  const stable = at >= 0 && TIMESTAMP_TAIL.test(buf.subarray(at).toString('utf8')) ? buf.subarray(0, at) : buf;
  return `W/"${createHash('sha1').update(stable).digest('base64url')}"`;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // Mutate in place when the handler already returned a plain object —
        // the spread used to allocate a fresh top-level object on every
        // response. Services return their own plain objects and don't reuse
        // them, so mutation is safe here.
        if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
          (data as any).success = true;
          (data as any).timestamp = new Date().toISOString();
          return data;
        }
        return { data, success: true, timestamp: new Date().toISOString() };
      }),
    );
  }
}
