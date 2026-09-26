/**
 * آزمونِ seamِ بارگذاریِ رسانه (فاز ۶.۷).
 *
 * این آزمون یک Nest واقعی بالا می‌آورد و فایلِ **واقعی** آپلود می‌کند؛ نه mock.
 * آنچه اثبات می‌شود:
 *   ۱) تأمین‌کنندهٔ واردشده فایل را آپلود می‌کند و `url` واقعی می‌گیرد.
 *   ۲) همان `url` بعداً واقعاً فایل را سرو می‌کند (بایت‌ها یکی‌اند).
 *   ۳) کاربرِ ناشناس نمی‌تواند آپلود کند.
 *   ۴) نوعِ رسانهٔ نامعتبر رد می‌شود.
 *   ۵) هیچ کلید/رمزی در پاسخ نشت نمی‌کند.
 *   ۶) path-traversal روی مسیرِ سرو رد می‌شود.
 */

import { execFileSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import path from "node:path";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../packages/database/src/schema/tables";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_6_7_media_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const PASSWORD = "Kolbe!Media123";
const MEDIA_DIR = path.join(ROOT, "node_modules", ".kolbe-media-test");

let pool: Pool;
let db: any;
let app: any;
let http: any;
let supplierCookie = "";
let customerCookie = "";
let supplierId = "";

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** کوچک‌ترین PNGِ معتبر (۱×۱). */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

async function login(email: string): Promise<string> {
  const res = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const raw = res.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  expect(value, "no session cookie").toBeDefined();
  return String(value).split(";")[0] as string;
}

describe("Phase 6.7 — media upload seam (real files, real HTTP)", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    } finally {
      await admin.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-media-67";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.KOLBE_MEDIA_DIR = MEDIA_DIR;
    // پروایدرِ S3 باید خاموش باشد تا پروایدرِ محلیِ واقعی استفاده شود.
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;

    pool = new Pool({ connectionString: TEST_URL });
    pool.on("error", () => {});
    db = drizzle(pool, { schema });

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = app.getHttpServer();

    const salt = "kolbe-media-salt";
    const passwordHash = scryptSync(PASSWORD, salt, 64).toString("hex");
    const supplierUser = makeId("usr_sup");
    const customerUser = makeId("usr_cus");
    supplierId = makeId("sup");
    const sellerId = makeId("sel");

    await db.insert(schema.accountUser).values([
      { id: supplierUser, email: `${supplierUser}@kolbe.test`, passwordHash, salt, role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
      { id: customerUser, email: `${customerUser}@kolbe.test`, passwordHash, salt, role: "customer", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
    ]);
    await db.insert(schema.supplier).values({ id: supplierId, legalName: "رسانهٔ آزمایشی", displayName: "Media Test", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId, displayName: "Media Seller", status: "active" });
    await db.insert(schema.supplierMember).values({ id: makeId("mem"), supplierId, userId: supplierUser, role: "owner", title: "Owner" });

    supplierCookie = await login(`${supplierUser}@kolbe.test`);
    customerCookie = await login(`${customerUser}@kolbe.test`);
  }, 240_000);

  afterAll(async () => {
    try { await app?.close(); } catch {}
    try { await pool?.end(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
    const fs = await import("node:fs");
    fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
  });

  it("uploads a real image for an authenticated supplier and returns a usable url", async () => {
    const res = await request(http)
      .post("/api/v1/media/upload")
      .set("Cookie", supplierCookie)
      .attach("file", PNG_BYTES, { filename: "main.png", contentType: "image/png" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(typeof res.body.url).toBe("string");
    expect(res.body.url.startsWith("/api/v1/media/files/")).toBe(true);
    expect(res.body.size).toBe(PNG_BYTES.byteLength);
    expect(res.body.kind).toBe("image");
    expect(res.body.provider).toBe("local");
  });

  it("serves the stored bytes back unchanged at the returned url", async () => {
    const upload = await request(http)
      .post("/api/v1/media/upload")
      .set("Cookie", supplierCookie)
      .attach("file", PNG_BYTES, { filename: "serve.png", contentType: "image/png" });
    expect(upload.status).toBe(201);

    const served = await request(http).get(upload.body.url as string);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(served.body as Buffer).equals(PNG_BYTES)).toBe(true);
  });

  it("rejects anonymous uploads", async () => {
    const res = await request(http)
      .post("/api/v1/media/upload")
      .attach("file", PNG_BYTES, { filename: "anon.png", contentType: "image/png" });
    expect([401, 403]).toContain(res.status);
  });

  it("rejects a customer (non-supplier) upload", async () => {
    const res = await request(http)
      .post("/api/v1/media/upload")
      .set("Cookie", customerCookie)
      .attach("file", PNG_BYTES, { filename: "cus.png", contentType: "image/png" });
    expect(res.status).toBe(403);
  });

  it("rejects an unsupported content type instead of storing it", async () => {
    const res = await request(http)
      .post("/api/v1/media/upload")
      .set("Cookie", supplierCookie)
      .attach("file", Buffer.from("#!/bin/sh\necho hi\n"), { filename: "evil.sh", contentType: "application/x-sh" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("leaks no storage credentials in the response", async () => {
    const res = await request(http)
      .post("/api/v1/media/upload")
      .set("Cookie", supplierCookie)
      .attach("file", PNG_BYTES, { filename: "leak.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    const raw = JSON.stringify(res.body).toLowerCase();
    for (const secret of ["secret", "access_key", "accesskey", "s3_", "authorization", "signature"]) {
      expect(raw, `response leaked ${secret}`).not.toContain(secret);
    }
  });

  it("refuses path traversal on the serve route", async () => {
    for (const attempt of [
      "/api/v1/media/files/../../../../etc/passwd",
      "/api/v1/media/files/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/api/v1/media/files/1999/01/zzz-not-a-real-key.png",
    ]) {
      const res = await request(http).get(attempt);
      expect(res.status, attempt).toBe(404);
    }
  });
});
