import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const body = typeof data === 'object' && data !== null ? data : { data };
        // success/timestamp are spread LAST so a service that happens to
        // return its own success/timestamp keys can't override the wrapper
        // contract callers depend on.
        return { ...body, success: true, timestamp: new Date().toISOString() };
      }),
    );
  }
}
