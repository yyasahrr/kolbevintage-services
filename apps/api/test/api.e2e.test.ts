import { execFileSync } from "node:child_process";
import path from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * آزمون سرتاسری بک‌اند NestJS.
 *
 * چه چیزی را اثبات می‌کند؟
 *  ۱) اپلیکیشن واقعاً بالا می‌آید (DI، پیکربندی، اتصال دیتابیس).
 *  ۲) مهاجرت‌های Drizzle کافی‌اند تا سرویس روی آن‌ها کار کند.
 *  ۳) `/api/v1/health` بدون احراز هویت در دسترس است و وضعیت دیتابیس را می‌سنجد.
 *  ۴) `/api/v1/audit/logs` بدون توکن و با نقش غیرمدیر بسته است (پیش‌فرض بسته).
 *  ۵) توکن معتبر نقش مدیر کار می‌کند — یعنی سازگاری نشست با route handler قدیمی.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_api_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let sessionToken: string;
let customerToken: string;

async function recreateDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
}

describe("Kolbe API (NestJS) — قرارداد پایه", () => {
  beforeAll(async () => {
    // ۱) دیتابیس امبدد را بالا بیاور و دیتابیس تست را از صفر بساز.
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();

    // ۲) مهاجرت‌های Drizzle را اعمال کن — سرویس روی اسکیمای مهاجرت‌شده اجرا می‌شود،
    //    نه روی DDL درون‌برنامه‌ای (این تفاوت در پایان فاز ۱ باید صفر باشد).
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-for-nest-api-integration-tests";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    // ۳) اپلیکیشن را با همان تنظیمات main.ts می‌سازیم (پیشوند + لولهٔ اعتبارسنجی).
    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // همان تابعی که main.ts استفاده می‌کند — تا آزمون، سند واقعی OpenAPI را بسنجد.
    const { setupOpenApi } = await import("../src/openapi");
    setupOpenApi(app);
    await app.init();

    // ۴) کاربران تست را در دیتابیس می‌سازیم و توکن‌ها را با همان الگوریتم route handler قدیمی می‌سازیم
    //    تا «هم‌ارزی نشست» اثبات شود (کاربری که در فروشگاه وارد شده، در /api/v1 هم شناخته می‌شود).
    //    فاز ۲: guard نسخهٔ توکن را در برابر دیتابیس چک می‌کند، پس کاربر باید واقعاً وجود داشته باشد.
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    const client = new Client({ connectionString: TEST_URL });
    await client.connect();
    try {
      // پاک‌سازی و درج کاربران تست با scrypt ساده (همان الگوریتم لگاسی)
      const { scryptSync, randomBytes } = await import("node:crypto");
      function pw(p: string) {
        const salt = randomBytes(16).toString("hex");
        return { salt, hash: scryptSync(p, salt, 64).toString("hex") };
      }
      const adminPw = pw("AdminTest123!");
      const customerPw = pw("CustomerTest123!");
      await client.query(`INSERT INTO account_user (id,email,password_hash,salt,role,status,token_version,failed_login_attempts) VALUES ('usr_admin_test','admin@test.kolbe.ir',$1,$2,'admin','active',0,0) ON CONFLICT (id) DO UPDATE SET password_hash=$1, salt=$2, role='admin', status='active', token_version=0`, [adminPw.hash, adminPw.salt]);
      await client.query(`INSERT INTO account_user (id,email,password_hash,salt,role,status,token_version,failed_login_attempts) VALUES ('usr_customer_test','customer@test.kolbe.ir',$1,$2,'customer','active',0,0) ON CONFLICT (id) DO UPDATE SET password_hash=$1, salt=$2, role='customer', status='active', token_version=0`, [customerPw.hash, customerPw.salt]);
    } finally { await client.end(); }
    sessionToken = verifier.issue("usr_admin_test", "admin", 0);
    customerToken = verifier.issue("usr_customer_test", "customer", 0);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("GET /api/v1/health عمومی است و وضعیت دیتابیس را برمی‌گرداند", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe("kolbe-api");
    expect(response.body.database.status).toBe("up");
  });

  it("GET /api/v1/audit/logs بدون توکن ۴۰۱ می‌دهد", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/audit/logs").expect(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
  });

  it("GET /api/v1/audit/logs با نقش مشتری ۴۰۳ می‌دهد", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/audit/logs")
      .set("authorization", `Bearer ${customerToken}`)
      .expect(403);
    expect(response.body.error).toBe("FORBIDDEN");
  });

  it("توکن جعلی رد می‌شود", async () => {
    const forged = `${Buffer.from(
      JSON.stringify({ sub: "usr_x", role: "admin", exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString("base64url")}.not-a-real-signature`;
    await request(app.getHttpServer())
      .get("/api/v1/audit/logs")
      .set("authorization", `Bearer ${forged}`)
      .expect(401);
  });

  it("توکن معتبر مدیر با هدر Bearer کار می‌کند", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/audit/logs")
      .set("authorization", `Bearer ${sessionToken}`)
      .expect(200);
    expect(Array.isArray(response.body.logs)).toBe(true);
  });

  it("کوکی HttpOnly هم معتبر است (dual-read در دورهٔ گذار)", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/audit/logs")
      .set("cookie", `kolbe_session=${sessionToken}`)
      .expect(200);
    expect(Array.isArray(response.body.logs)).toBe(true);
  });

  it("رکورد حسابرسی از طریق سرویس ثبت می‌شود و جدول فقط-افزودنی است", async () => {
    const { AuditService } = await import("../src/modules/audit/audit.service");
    const audit = app.get(AuditService);
    await audit.record({
      actorId: "usr_admin_test",
      actorRole: "admin",
      action: "test.action",
      entityType: "test_entity",
      entityId: "1",
      after: { ok: true },
    });

    const rows = await audit.listForEntity("test_entity", "1");
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("test.action");

    // حذف فیزیکی در سطح دیتابیس رد می‌شود (قاعدهٔ A13).
    const client = new Client({ connectionString: TEST_URL });
    await client.connect();
    try {
      await expect(
        client.query("UPDATE audit_log SET action='tampered' WHERE entity_id='1'"),
      ).rejects.toThrowError(/append-only/i);
    } finally {
      await client.end();
    }
  });

  it("Swagger/OpenAPI سرو می‌شود (قرارداد API از روز اول)", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/openapi.json").expect(200);
    expect(response.body.info.title).toBe("Kolbe Vintage API");
    expect(Object.keys(response.body.paths)).toContain("/api/v1/health");
  });

  it("پیکربندی نامعتبر در تولید مانع بالا آمدن سرویس می‌شود (fail-closed)", async () => {
    const { ConfigurationError, loadConfig } = await import("../src/config/configuration");
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: TEST_URL,
        // عمداً بدون KOLBE_SESSION_SECRET و بدون متغیرهای S3
      } as NodeJS.ProcessEnv),
    ).toThrowError(ConfigurationError);

    try {
      loadConfig({ NODE_ENV: "production", DATABASE_URL: TEST_URL } as NodeJS.ProcessEnv);
    } catch (error) {
      const problems = (error as InstanceType<typeof ConfigurationError>).problems.join(" ");
      expect(problems).toContain("KOLBE_SESSION_SECRET");
      expect(problems).toContain("S3_BUCKET");
    }
  });
});
