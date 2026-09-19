/**
 * پیکربندی و اعتبارسنجی متغیرهای محیطی — فاز ۴.۹ سخت‌سازی تولید.
 *
 * قاعدهٔ ممیزی D4 & فاز ۴.۹ Checkpoint A:
 *   - نبود یا ناامنیِ راز نشست در تولید مانع بالا آمدن سرویس می‌شود (fail-closed).
 *   - رازهای ضعیف یا placeholder در تولید رد می‌شوند.
 *   - ارائه‌دهنده‌های fake/mock در تولید مسدود هستند.
 *   - کاشت داده‌های نمایشی (KOLBE_SEED_DEMO_DATA) در تولید اکیداً ممنوع است.
 *   - توکن‌های داخلی الزامی هستند.
 *   - هیچ رازی در لاگ‌ها افشا نمی‌شود.
 */

export type AppConfig = {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  database: {
    url: string;
    poolMax: number;
    poolMin: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    statementTimeoutMs: number;
  };
  sessionSecret: string;
  internalApiToken: string | null;
  allowedOrigins: string[];
  redisUrl: string | null;
  recovery?: {
    schedulerEnabled: boolean;
    intervalMs: number;
  };
  trustProxy: boolean | number;
  storage: {
    endpoint: string | null;
    bucket: string | null;
    region: string | null;
    accessKey: string | null;
    secretKey: string | null;
  };
};

const DEV_SESSION_SECRET = "kolbe-dev-secret-change-me";

const INSECURE_SECRET_PATTERNS = [
  /change[-_]?me/i,
  /replace[-_]?me/i,
  /kolbe[-_]?dev/i,
  /test[-_]?secret/i,
  /placeholder/i,
  /^secret$/i,
  /^password$/i,
  /123456/,
  /^default$/i,
  /^admin$/i,
];

export class ConfigurationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`پیکربندی نامعتبر است:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigurationError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? "development") as AppConfig["env"];
  const isProduction = nodeEnv === "production";
  const problems: string[] = [];

  const databaseUrl = env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/kolbe";
  if (!databaseUrl) problems.push("DATABASE_URL تعیین نشده است");

  const sessionSecretCandidate = env.KOLBE_SESSION_SECRET ?? env.JWT_SECRET ?? "";
  if (isProduction) {
    if (sessionSecretCandidate.length < 32) {
      problems.push(
        "KOLBE_SESSION_SECRET در محیط تولید باید حداقل ۳۲ کاراکتر باشد (توکن‌ها با آن امضا می‌شوند)",
      );
    }
    if (INSECURE_SECRET_PATTERNS.some((pattern) => pattern.test(sessionSecretCandidate))) {
      problems.push(
        "KOLBE_SESSION_SECRET در محیط تولید نباید شامل الگوهای ناامن یا پیش‌فرض (مانند dev, secret, changeme) باشد",
      );
    }
  }

  const internalApiToken = env.KOLBE_INTERNAL_API_TOKEN ?? null;
  if (isProduction) {
    if (!internalApiToken || internalApiToken.length < 32) {
      problems.push(
        "KOLBE_INTERNAL_API_TOKEN در محیط تولید الزامی است و باید حداقل ۳۲ کاراکتر باشد",
      );
    } else if (INSECURE_SECRET_PATTERNS.some((pattern) => pattern.test(internalApiToken))) {
      problems.push("KOLBE_INTERNAL_API_TOKEN در محیط تولید نباید شامل الگوهای ناامن یا پیش‌فرض باشد");
    }
  }

  if (isProduction && env.KOLBE_SEED_DEMO_DATA === "true") {
    problems.push("KOLBE_SEED_DEMO_DATA در محیط تولید اکیداً ممنوع است و نباید فعال باشد");
  }

  // بررسی ارائه‌دهنده‌های آزمایشی در تولید
  if (isProduction) {
    const paymentMode = (env.PAYMENT_PROVIDER_MODE ?? env.WHOLESALE_PAYMENT_PROVIDER ?? "").trim().toLowerCase();
    if (paymentMode === "fake") {
      problems.push("FakePaymentProvider در محیط تولید مجاز نیست");
    }
    const shippingMode = (env.SHIPPING_PROVIDER_MODE ?? env.WHOLESALE_SHIPPING_PROVIDER ?? "").trim().toLowerCase();
    if (shippingMode === "fake") {
      problems.push("FakeShippingProvider در محیط تولید مجاز نیست");
    }
    const taxMode = (env.TAX_INVOICE_PROVIDER_MODE ?? "").trim().toLowerCase();
    if (taxMode === "fake") {
      problems.push("FakeTaxInvoiceProvider در محیط تولید مجاز نیست");
    }
    const payoutMode = (env.PAYOUT_PROVIDER_MODE ?? "").trim().toLowerCase();
    if (payoutMode === "fake" && env.ALLOW_FAKE_PAYOUT_PROVIDER !== "true") {
      problems.push("FakePayoutProvider در محیط تولید مجاز نیست");
    }
  }

  const allowedOrigins = (env.KOLBE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (isProduction && allowedOrigins.length === 0) {
    problems.push(
      "KOLBE_ALLOWED_ORIGINS در محیط تولید باید فهرست مبدأهای مجاز باشد (پیش‌فرض: فقط same-origin)",
    );
  }

  if (isProduction) {
    for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
      if (!env[key]) problems.push(`${key} برای ذخیره‌سازی S3/ParsPack تعیین نشده است`);
    }
  }

  if (problems.length) throw new ConfigurationError(problems);

  const poolMax = Number(env.DATABASE_POOL_MAX || (isProduction ? 20 : 10));
  const poolMin = Number(env.DATABASE_POOL_MIN || (isProduction ? 2 : 0));
  const idleTimeoutMs = Number(env.DATABASE_IDLE_TIMEOUT_MS || 30000);
  const connectionTimeoutMs = Number(env.DATABASE_CONNECTION_TIMEOUT_MS || 5000);
  const statementTimeoutMs = Number(env.DATABASE_STATEMENT_TIMEOUT_MS || 15000);

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl,
    database: {
      url: databaseUrl,
      poolMax,
      poolMin,
      idleTimeoutMs,
      connectionTimeoutMs,
      statementTimeoutMs,
    },
    sessionSecret: sessionSecretCandidate || DEV_SESSION_SECRET,
    internalApiToken,
    allowedOrigins,
    redisUrl: env.REDIS_URL ?? null,
    recovery: {
      schedulerEnabled: env.ENABLE_RECOVERY_SCHEDULER === "true",
      intervalMs: Number(env.RECOVERY_INTERVAL_MS || 60000),
    },
    trustProxy: env.TRUST_PROXY ? (env.TRUST_PROXY === "true" ? true : Number(env.TRUST_PROXY)) : true,
    storage: {
      endpoint: env.S3_ENDPOINT ?? null,
      bucket: env.S3_BUCKET ?? null,
      region: env.S3_REGION ?? "default",
      accessKey: env.S3_ACCESS_KEY ?? null,
      secretKey: env.S3_SECRET_KEY ?? null,
    },
  };
}

/**
 * ماسک‌کردن رازهای پیکربندی برای ثبت ایمن در لاگ یا خطایابی.
 */
export function toSafeConfig(config: AppConfig): Record<string, unknown> {
  const mask = (val: string | null | undefined, visibleCount = 4) => {
    if (!val) return "[EMPTY]";
    if (val.length <= visibleCount) return "***";
    return `${val.slice(0, visibleCount)}***`;
  };

  const sanitizeUrl = (rawUrl: string) => {
    try {
      const u = new URL(rawUrl);
      if (u.password) u.password = "REDACTED";
      return u.toString();
    } catch {
      return "[MALFORMED_URL]";
    }
  };

  return {
    env: config.env,
    port: config.port,
    databaseUrl: sanitizeUrl(config.databaseUrl),
    database: {
      url: sanitizeUrl(config.database?.url ?? config.databaseUrl),
      poolMax: config.database?.poolMax ?? 10,
      poolMin: config.database?.poolMin ?? 0,
      idleTimeoutMs: config.database?.idleTimeoutMs ?? 30000,
      connectionTimeoutMs: config.database?.connectionTimeoutMs ?? 5000,
      statementTimeoutMs: config.database?.statementTimeoutMs ?? 15000,
    },
    sessionSecret: mask(config.sessionSecret, 6),
    internalApiToken: mask(config.internalApiToken, 6),
    allowedOrigins: config.allowedOrigins,
    redisUrl: config.redisUrl ? sanitizeUrl(config.redisUrl) : null,
    trustProxy: config.trustProxy,
    storage: {
      endpoint: config.storage.endpoint,
      bucket: config.storage.bucket,
      region: config.storage.region,
      accessKey: mask(config.storage.accessKey, 4),
      secretKey: mask(config.storage.secretKey, 2),
    },
  };
}

export const CONFIG_TOKEN = Symbol("KOLBE_CONFIG");
