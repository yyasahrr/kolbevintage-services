import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_METADATA_KEY = "kolbe:rate_limit";

export type RateLimitOptions = {
  limit: number;
  windowSeconds: number;
  keyPrefix?: string;
  scope?: "ip" | "user" | "user_or_ip";
};

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_METADATA_KEY, options);
