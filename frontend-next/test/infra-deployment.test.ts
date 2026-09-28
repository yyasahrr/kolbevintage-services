/**
 * بازبینی استقرار (فاز ۱.۳) — تست‌های ایستای زیرساخت.
 *
 * این تست‌ها روی میزبان دارای Docker هم کار می‌کنند و روی محیط بدون Docker هم
 * باید سبز باشند، چون فقط فایل‌ها را می‌خوانند و `docker compose config` یا
 * `nginx -t` را اجرا نمی‌کنند (آن‌ها در `infra:verify` و `verify-deployment.mjs`
 * جداگانه بررسی می‌شوند).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

const root = path.resolve(__dirname, "..", "..");

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file: string) {
  return fs.existsSync(path.join(root, file));
}

describe("زیرساخت — فایل‌های کلیدی وجود دارند", () => {
  const files = [
    "infra/compose/docker-compose.dev.yml",
    "infra/compose/docker-compose.prod.yml",
    "infra/docker/api.Dockerfile",
    "infra/docker/storefront.Dockerfile",
    "infra/docker/portal.Dockerfile",
    "infra/nginx/kolbe.conf",
    "infra/nginx/kolbe-proxy-params.conf",
    "infra/nginx/portal-spa.conf",
    "infra/.env.example",
    "docs/deployment.md",
    "infra/README.md",
  ];
  for (const f of files) {
    it(`${f} وجود دارد`, () => {
      expect(exists(f)).toBe(true);
    });
  }
});

describe("Compose — توپولوژی و سلامت", () => {
  it("dev compose: postgres, redis, minio دارد و minio healthcheck از mc استفاده نمی‌کند", () => {
    const raw = read("infra/compose/docker-compose.dev.yml");
    const doc = yaml.load(raw) as any;
    expect(doc.services.postgres).toBeDefined();
    expect(doc.services.redis).toBeDefined();
    expect(doc.services.minio).toBeDefined();
    // healthcheck باید curl/wget باشد، نه mc
    const hc = doc.services.minio.healthcheck?.test;
    const hcStr = JSON.stringify(hc);
    expect(hcStr).not.toContain('"mc"');
    expect(hcStr).toContain("curl");
  });

  it("prod compose: postgres, redis, migrate, api, storefront, nginx دارد", () => {
    const raw = read("infra/compose/docker-compose.prod.yml");
    const doc = yaml.load(raw) as any;
    expect(doc.services.postgres).toBeDefined();
    expect(doc.services.redis).toBeDefined();
    expect(doc.services.migrate).toBeDefined();
    expect(doc.services.api).toBeDefined();
    expect(doc.services.storefront).toBeDefined();
    expect(doc.services.nginx).toBeDefined();
  });

  it("prod compose: migrate فقط DATABASE_URL لازم دارد (نه S3)", () => {
    const raw = read("infra/compose/docker-compose.prod.yml");
    // باید x-migrate-env جدا داشته باشد
    expect(raw).toContain("x-migrate-env");
    expect(raw).toContain("DATABASE_URL");
    // migrate باید از migrate-env استفاده کند، نه api-env
    const migrateSection = raw.split("migrate:")[1] ?? "";
    // در ۲۰ خط اول بعد از migrate: باید environment: *migrate-env باشد
    const firstLines = migrateSection.split("\n").slice(0, 20).join("\n");
    expect(firstLines).toContain("migrate-env");
  });

  it("prod compose: postgres و redis فقط expose دارند، نه ports (امنیت)", () => {
    const raw = read("infra/compose/docker-compose.prod.yml");
    const doc = yaml.load(raw) as any;
    expect(doc.services.postgres.expose).toBeDefined();
    expect(doc.services.postgres.ports).toBeUndefined();
    expect(doc.services.redis.expose).toBeDefined();
    expect(doc.services.redis.ports).toBeUndefined();
  });

  it("prod compose: nginx depends_on با service_healthy", () => {
    const raw = read("infra/compose/docker-compose.prod.yml");
    // nginx باید به api و storefront با condition: service_healthy وابسته باشد
    expect(raw).toMatch(/nginx:[\s\S]*?api:\s*\n\s*condition:\s*service_healthy/);
    expect(raw).toMatch(/nginx:[\s\S]*?storefront:\s*\n\s*condition:\s*service_healthy/);
  });

  it("prod compose: متغیرهای الزامی با :? مشخص شده‌اند", () => {
    const raw = read("infra/compose/docker-compose.prod.yml");
    expect(raw).toContain("DATABASE_URL:?"); // باید required باشد
    expect(raw).toContain("KOLBE_SESSION_SECRET:?"); // باید required باشد
    expect(raw).toContain("POSTGRES_PASSWORD:?"); // باید required باشد
  });
});

describe("Dockerfile — امنیت و سلامت", () => {
  it("api.Dockerfile: USER non-root و HEALTHCHECK و migrations دارد", () => {
    const c = read("infra/docker/api.Dockerfile");
    expect(c).toContain("USER node");
    expect(c).toMatch(/HEALTHCHECK/i);
    expect(c).toContain("migrations");
    expect(c).toContain("migrate.mjs");
  });

  it("storefront.Dockerfile: USER non-root، --workspaces، packages/database و migrations", () => {
    const c = read("infra/docker/storefront.Dockerfile");
    expect(c).toContain("USER node");
    expect(c).toContain("--workspaces");
    expect(c).toContain("packages/database");
    expect(c).toContain("migrations");
    expect(c).toMatch(/HEALTHCHECK/i);
  });

  it("portal.Dockerfile: USER nginx و HEALTHCHECK", () => {
    const c = read("infra/docker/portal.Dockerfile");
    expect(c).toContain("USER nginx");
    expect(c).toMatch(/HEALTHCHECK/i);
  });
});

describe("Nginx — پیکربندی", () => {
  it("kolbe.conf: upstreamهای api و storefront دارد", () => {
    const c = read("infra/nginx/kolbe.conf");
    expect(c).toContain("upstream kolbe_api");
    expect(c).toContain("server api:4000");
    expect(c).toContain("upstream kolbe_storefront");
    expect(c).toContain("server storefront:3000");
  });

  it("kolbe.conf: /healthz برای liveness دارد", () => {
    const c = read("infra/nginx/kolbe.conf");
    expect(c).toContain("location = /healthz");
    expect(c).toContain('return 200 "ok');
  });

  it("kolbe.conf: proxy_pass به upstreamهای تعریف‌شده اشاره می‌کند", () => {
    const c = read("infra/nginx/kolbe.conf");
    // همه proxy_pass باید به kolbe_api یا kolbe_storefront اشاره کنند
    const passes = [...c.matchAll(/proxy_pass\s+http:\/\/([\w-]+)/g)].map((m) => m[1]);
    for (const p of passes) {
      expect(["kolbe_api", "kolbe_storefront"]).toContain(p);
    }
  });

  it("kolbe.conf: nested location برای auth/login ندارد (باید جدا باشد)", () => {
    const c = read("infra/nginx/kolbe.conf");
    // الگوی قدیمی: location /api/v1/ { ... location /api/v1/auth/login
    expect(c).not.toMatch(/location\s+\/api\/v1\/\s*\{[^}]*location\s+\/api\/v1\/auth\/login/s);
  });

  it("kolbe-proxy-params.conf: proxy_no_cache و proxy_cache_bypass دارد", () => {
    const c = read("infra/nginx/kolbe-proxy-params.conf");
    expect(c).toContain("proxy_no_cache");
    expect(c).toContain("proxy_cache_bypass");
    expect(c).toContain("proxy_buffering off");
  });

  it("kolbe-proxy-params.conf: X-Request-ID و Connection upgrade دارد", () => {
    const c = read("infra/nginx/kolbe-proxy-params.conf");
    expect(c).toContain("X-Request-ID");
    expect(c).toContain("kolbe_connection_upgrade");
  });
});

describe("محیط — .env.example", () => {
  it("infra/.env.example همهٔ متغیرهای لازم Compose را مستند کرده", () => {
    const envExample = read("infra/.env.example");
    const composeProd = read("infra/compose/docker-compose.prod.yml");
    const required = new Set<string>();
    for (const m of composeProd.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
      required.add(m[1]);
    }
    for (const v of required) {
      expect(envExample).toContain(v);
    }
  });

  it("root .env.example برای توسعه کافی است", () => {
    const rootEnv = read(".env.example");
    expect(rootEnv).toContain("DATABASE_URL");
    expect(rootEnv).toContain("KOLBE_SESSION_SECRET");
    expect(rootEnv).toContain("KOLBE_SEED_DEMO_DATA");
  });
});

describe("مستندات استقرار", () => {
  it("docs/deployment.md وجود دارد و شامل بخش‌های الزامی است", () => {
    const doc = read("docs/deployment.md");
    expect(doc).toContain("توپولوژی");
    expect(doc).toContain("استقرار محلی");
    expect(doc).toContain("استقرار تولید");
    expect(doc).toContain("DATABASE_URL");
    expect(doc).toContain("backup");
    expect(doc).toContain("health");
    expect(doc).toContain("Nginx");
  });

  it("infra/README.md وجود دارد و دستورات را مستند کرده", () => {
    const readme = read("infra/README.md");
    expect(readme).toContain("docker compose");
    expect(readme).toContain("postgres");
    expect(readme).toContain("api");
  });
});

describe("شکست‌ها — رفتار موردانتظار", () => {
  it("وقتی DATABASE_URL نیست، compose config با :? خطای واضح می‌دهد (static check)", () => {
    // این تست فقط مستندسازی رفتار است — اجرای واقعی نیاز به Docker دارد
    const prod = read("infra/compose/docker-compose.prod.yml");
    expect(prod).toContain("DATABASE_URL:?DATABASE_URL لازم است");
  });

  it("وقتی مهاجرت اعمال نشده، نگهبان اسکیما باید ببندد (fail closed)", () => {
    // این رفتار در تست‌های startup-guard و schema-authority قبلاً پوشش داده شده
    // اینجا فقط مطمئن می‌شویم که Dockerfileها migrations را کپی می‌کنند تا نگهبان کار کند
    const apiDocker = read("infra/docker/api.Dockerfile");
    const storeDocker = read("infra/docker/storefront.Dockerfile");
    expect(apiDocker).toContain("migrations");
    expect(storeDocker).toContain("migrations");
  });
});
