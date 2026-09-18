/**
 * پیکربندی و اعتبارسنجی متغیرهای محیطی.
 *
 * قاعدهٔ ممیزی D4: نبودِ راز نشست در تولید باید **مانع بالا آمدن سرویس** شود
 * (fail-closed)، نه اینکه به یک مقدار پیش‌فرض قابل‌حدس برگردد. در route handler
 * قدیمی همین سیاست اعمال شد؛ اینجا در سطح bootstrap اپلیکیشن اجرا می‌شود تا
 * سرویس حتی یک درخواست هم نپذیرد.
 */

export type AppConfig = {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  allowedOrigins: string[];
  redisUrl: string | null;
  storage: {
    endpoint: string | null;
    bucket: string | null;
    region: string | null;
    accessKey: string | null;
    secretKey: string | null;
  };
};

const DEV_SESSION_SECRET = "kolbe-dev-secret-change-me";

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
  if (isProduction && sessionSecretCandidate.length < 32) {
    problems.push(
      "KOLBE_SESSION_SECRET در محیط تولید باید حداقل ۳۲ کاراکتر باشد (توکن‌ها با آن امضا می‌شوند)",
    );
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

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl,
    sessionSecret: sessionSecretCandidate || DEV_SESSION_SECRET,
    allowedOrigins,
    redisUrl: env.REDIS_URL ?? null,
    storage: {
      endpoint: env.S3_ENDPOINT ?? null,
      bucket: env.S3_BUCKET ?? null,
      region: env.S3_REGION ?? "default",
      accessKey: env.S3_ACCESS_KEY ?? null,
      secretKey: env.S3_SECRET_KEY ?? null,
    },
  };
}

export const CONFIG_TOKEN = Symbol("KOLBE_CONFIG");
