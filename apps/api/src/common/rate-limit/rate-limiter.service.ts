import { Inject, Injectable, Logger } from "@nestjs/common";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger("RateLimiter");
  private readonly buckets = new Map<string, Bucket>();
  private readonly MAX_BUCKETS = 50_000;

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  private pruneExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  async consume(key: string, limit: number, windowSeconds: number, now = Date.now()): Promise<RateLimitResult> {
    const windowMs = windowSeconds * 1000;

    // پاک‌سازی حافظه در صورت رسیدن به سقف
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

  resetAll(): void {
    this.buckets.clear();
  }

  bucketCount(): number {
    return this.buckets.size;
  }
}
