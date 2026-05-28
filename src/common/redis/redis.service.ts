import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

type MessageHandler = (channel: string, message: string) => void;

/**
 * Thin wrapper around a pair of ioredis clients (one for commands, one for
 * pub/sub — ioredis rejects normal commands on a subscribed connection).
 *
 * The service is provided unconditionally so callers don't need null-checks
 * everywhere; when REDIS_URL is unset the clients are `null` and the
 * publish/subscribe helpers no-op. `isEnabled()` lets a caller short-circuit
 * if a Redis-specific path is significant.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly subscriptions = new Map<string, MessageHandler[]>();

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client: Redis | null,
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis | null,
  ) {
    if (this.subscriber) {
      this.subscriber.on('message', (channel, message) => {
        const handlers = this.subscriptions.get(channel);
        if (!handlers) return;
        for (const h of handlers) {
          try {
            h(channel, message);
          } catch (err) {
            this.logger.warn(`Redis message handler for "${channel}" threw: ${err}`);
          }
        }
      });
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  getClient(): Redis | null {
    return this.client;
  }

  async publish(channel: string, message: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.publish(channel, message);
    } catch (err) {
      this.logger.warn(`Redis publish to "${channel}" failed: ${err}`);
    }
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    if (!this.subscriber) return;
    const existing = this.subscriptions.get(channel) ?? [];
    existing.push(handler);
    this.subscriptions.set(channel, existing);
    if (existing.length === 1) {
      try {
        await this.subscriber.subscribe(channel);
      } catch (err) {
        this.logger.warn(`Redis subscribe to "${channel}" failed: ${err}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Best-effort: ioredis's `.quit()` flushes the outbound buffer; if Redis
    // is unreachable we fall back to a hard disconnect so shutdown doesn't
    // hang the dyno past the platform's grace window.
    await Promise.allSettled([
      this.client?.quit().catch(() => this.client?.disconnect()),
      this.subscriber?.quit().catch(() => this.subscriber?.disconnect()),
    ]);
  }
}
