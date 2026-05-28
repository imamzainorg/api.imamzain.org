import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER, RedisService } from './redis.service';

const logger = new Logger('RedisModule');

/**
 * Provides two ioredis clients (commands + subscriber) when REDIS_URL is set,
 * or null providers when it isn't. The service layer treats absence as
 * "single-instance fallback" — see RedisService comments for why.
 *
 * lazyConnect=true keeps the dyno from crashing at boot if Redis is briefly
 * unavailable; ioredis retries with exponential backoff in the background.
 * Pub/sub deliveries will start landing once the connection succeeds.
 */
function createClient(url: string, role: 'cmd' | 'sub'): Redis {
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: role === 'cmd' ? 3 : null, // null for subscriber: must persist
    enableOfflineQueue: role === 'cmd',
  });
  client.on('error', (err) => logger.warn(`Redis ${role} error: ${err.message}`));
  client.on('connect', () => logger.log(`Redis ${role} connected`));
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          logger.log('REDIS_URL not set — using in-process fallbacks (single-instance mode)');
          return null;
        }
        return createClient(url, 'cmd');
      },
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) return null;
        return createClient(url, 'sub');
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule {}
