import { HEADERS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { SiteMidnightCacheInterceptor } from '../interceptors/site-midnight-cache.interceptor';
import { PublicCache } from './public-cache.decorator';

class Sample {
  @PublicCache()
  defaults() {}

  @PublicCache(300, 1800)
  explicit() {}

  @PublicCache(900, 3600, { untilSiteMidnight: true })
  clamped() {}
}

const headersOf = (fn: unknown) => Reflect.getMetadata(HEADERS_METADATA, fn as object) as { name: string; value: string }[];
const interceptorsOf = (fn: unknown) => Reflect.getMetadata(INTERCEPTORS_METADATA, fn as object) as unknown[] | undefined;

describe('PublicCache', () => {
  it('without the option emits exactly the static headers and no interceptor (unchanged for every other route)', () => {
    expect(headersOf(Sample.prototype.defaults)).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'public, max-age=60, s-maxage=300' },
        { name: 'Vary', value: 'Accept-Language' },
      ]),
    );
    expect(headersOf(Sample.prototype.defaults)).toHaveLength(2);
    expect(headersOf(Sample.prototype.explicit)).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'public, max-age=300, s-maxage=1800' }]),
    );
    expect(interceptorsOf(Sample.prototype.defaults)).toBeUndefined();
    expect(interceptorsOf(Sample.prototype.explicit)).toBeUndefined();
  });

  it('untilSiteMidnight keeps the same static baseline and adds the clamping interceptor', () => {
    expect(headersOf(Sample.prototype.clamped)).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'public, max-age=900, s-maxage=3600' },
        { name: 'Vary', value: 'Accept-Language' },
      ]),
    );
    const interceptors = interceptorsOf(Sample.prototype.clamped);
    expect(interceptors).toHaveLength(1);
    expect(interceptors![0]).toBeInstanceOf(SiteMidnightCacheInterceptor);
  });
});
