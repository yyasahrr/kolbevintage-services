import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import Redis from "ioredis";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export interface RateLimiterBackend {
  consume(key: string, limit: number, windowSeconds: number, now?: number): Promise<RateLimitResult>;
  resetAll(): Promise<void>;
  count(): Promise<number>;
}

type Bucket = { count: number; resetAt: number };

/**
 * بک‌اند درون‌حافظه‌ای برای محیط توسعه و آزمون.
 */
export class MemoryRateLimiterBackend implements RateLimiterBackend {
  private readonly buckets = new Map<string, Bucket>();
  private readonly MAX_BUCKETS = 50_000;

  private pruneExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  async consume(key: string, limit: number, windowSeconds: number, now = Date.now()): Promise<RateLimitResult> {
    const windowMs = windowSeconds * 1000;

    if (this.buckets.size >= this.MAX_BUCKETS) {
      this.pruneExpired(now);
      if (this.buckets.size >= this.MAX_BUCKETS) {
        const oldest = [...this.buckets.entries()]
          .sort(([, a], [, b]) => a.resetAt - b.resetAt)
          .slice(0, Math.floor(this.MAX_BUCKETS / 2));
        for (const [oldKey] of oldest) {
          this.buckets.delete(oldKey);
        }
      }
    }

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetAt: Math.ceil(resetAt / 1000),
        retryAfterSeconds: Math.ceil(windowSeconds),
      };
    }

    if (existing.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: Math.ceil(existing.resetAt / 1000),
        retryAfterSeconds,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit,
      remaining: limit - existing.count,
      resetAt: Math.ceil(existing.resetAt / 1000),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  async resetAll(): Promise<void> {
    this.buckets.clear();
  }

  async count(): Promise<number> {
    return this.buckets.size;
  }
}

/**
 * اسکریپت اتمیک Lua برای Redis جهت شمارش و انقضای قطعی در پنجره‌های زمانی.
 */
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local windowSeconds = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, windowSeconds)
end
local ttl = redis.call('TTL', key)
if ttl < 0 then
  redis.call('EXPIRE', key, windowSeconds)
  ttl = windowSeconds
end

return { current, ttl }
`;

/**
 * بک‌اند مبتنی بر Redis برای محیط تولید و توزیع‌شده بین چندین رپلیکای API.
 */
export class RedisRateLimiterBackend implements RateLimiterBackend {
  private readonly prefix = "kolbe:rl:";

  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number, now = Date.now()): Promise<RateLimitResult> {
    const fullKey = `${this.prefix}${key}`;
    const result = (await this.redis.eval(
      RATE_LIMIT_LUA,
      1,
      fullKey,
      windowSeconds.toString(),
      limit.toString(),
    )) as [number, number];

    const current = Number(result[0]);
    const ttl = Number(result[1]);
    const resetAt = Math.ceil(now / 1000) + Math.max(1, ttl);
    const retryAfterSeconds = Math.max(1, ttl);

    if (current > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - current),
      resetAt,
      retryAfterSeconds,
    };
  }

  async resetAll(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async count(): Promise<number> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    return keys.length;
  }
}

@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly memoryBackend = new MemoryRateLimiterBackend();
  private redisBackend: RedisRateLimiterBackend | null = null;
  private redisClient: Redis | null = null;

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Optional() @Inject("REDIS_CLIENT_OVERRIDE") private readonly clientOverride?: Redis,
  ) {
    if (this.clientOverride) {
      this.redisClient = this.clientOverride;
      this.redisBackend = new RedisRateLimiterBackend(this.redisClient);
    } else if (this.config.redisUrl) {
      try {
        this.redisClient = new Redis(this.config.redisUrl, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2000,
        });
        this.redisClient.on("error", (err) => {
          this.logger.error(`خطای اتصال به Redis: ${err.message}`);
        });
        this.redisBackend = new RedisRateLimiterBackend(this.redisClient);
      } catch (err: any) {
        this.logger.error(`راه‌اندازی کلاینت Redis ناموفق بود: ${err?.message || err}`);
      }
    }
  }

  async onModuleDestroy() {
    if (this.redisClient && !this.clientOverride) {
      try {
        await this.redisClient.quit();
      } catch {
        // ignore
      }
    }
  }

  isUsingRedis(): boolean {
    return this.redisBackend !== null;
  }

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    options?: { sensitive?: boolean; now?: number },
  ): Promise<RateLimitResult> {
    const isSensitive = options?.sensitive ?? true;
    const now = options?.now ?? Date.now();

    // در محیط تولید، استفاده از Redis الزامی است و خطای Redis منجر به 503 fail-closed می‌شود
    if (this.config.env === "production") {
      if (!this.redisBackend) {
        throw new HttpException(
          {
            error: "RATE_LIMIT_BACKEND_UNAVAILABLE",
            message: "سرویس محدودسازی نرخ در دسترس نیست؛ عملیات به دلایل امنیتی مسدود شد",
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      try {
        return await this.redisBackend.consume(key, limit, windowSeconds, now);
      } catch (err: any) {
        this.logger.error(`خطای بک‌اند محدودکننده نرخ در تولید (کلید ${key}): ${err?.message || err}`);
        throw new HttpException(
          {
            error: "RATE_LIMIT_BACKEND_UNAVAILABLE",
            message: "سرویس محدودسازی نرخ در دسترس نیست؛ عملیات به دلایل امنیتی مسدود شد",
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }

    // در محیط توسعه و تست
    if (this.redisBackend) {
      try {
        return await this.redisBackend.consume(key, limit, windowSeconds, now);
      } catch (err: any) {
        this.logger.error(`خطای Redis در محیط غیرتولید: ${err?.message || err}`);
        if (isSensitive) {
          throw new HttpException(
            {
              error: "RATE_LIMIT_BACKEND_UNAVAILABLE",
              message: "سرویس محدودسازی نرخ در دسترس نیست؛ عملیات به دلایل امنیتی مسدود شد",
            },
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        return this.memoryBackend.consume(key, limit, windowSeconds, now);
      }
    }

    return this.memoryBackend.consume(key, limit, windowSeconds, now);
  }

  async resetAll(): Promise<void> {
    await this.memoryBackend.resetAll();
    if (this.redisBackend) {
      try {
        await this.redisBackend.resetAll();
      } catch {
        // ignore
      }
    }
  }

  async bucketCount(): Promise<number> {
    if (this.redisBackend) {
      try {
        return await this.redisBackend.count();
      } catch {
        return this.memoryBackend.count();
      }
    }
    return this.memoryBackend.count();
  }
}
