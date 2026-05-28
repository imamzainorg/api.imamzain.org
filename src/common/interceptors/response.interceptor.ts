import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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
