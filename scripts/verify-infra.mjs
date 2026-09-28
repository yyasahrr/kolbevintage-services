#!/usr/bin/env node
/**
 * بازبینی ایستای زیرساخت (Docker/Compose/Nginx).
 *
 * ── چرا این اسکریپت وجود دارد ───────────────────────────────────────────────
 * در محیط ساخت این مخزن Docker و Nginx نصب نیستند، پس نه imageها ساخته می‌شوند و
 * نه `nginx -t` اجرا می‌شود. این اسکریپت جایگزینِ کاملِ آن آزمایش نیست، اما
 * خطاهایی را می‌گیرد که در همین بازبینی دستی پیدا شدند و در استقرار واقعی
 * گران تمام می‌شوند:
 *
 *   1. YAML نامعتبر یا ساختار نادرست در فایل‌های Compose.
 *   2. ارجاع Nginx به upstreamی که سرویس متناظرش در Compose وجود ندارد
 *      ← nginx اصلاً بالا نمی‌آید («host not found in upstream»).
 *   3. `dockerfile:` که به فایل موجود اشاره نمی‌کند، یا `build.context` غلط.
 *   4. متغیرهای محیطی که Compose لازم دارد ولی در `.env.example` نیستند.
 *   5. وابستگی سرویس به سرویسِ تعریف‌نشده در `depends_on`.
 *
 * اجرا:  node scripts/verify-infra.mjs
 * خروج با کد ۱ در صورت یافتن خطا (قابل استفاده در CI).
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

// ── ۱) Compose ──────────────────────────────────────────────────────────────
const composeFiles = [
  "infra/compose/docker-compose.dev.yml",
  "infra/compose/docker-compose.prod.yml",
];

/** نام سرویس‌ها به‌ازای هر فایل compose — برای بررسی ارجاع‌های Nginx. */
const servicesByFile = new Map();

for (const rel of composeFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    fail(`${rel}: فایل وجود ندارد`);
    continue;
  }
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    fail(`${rel}: YAML نامعتبر — ${err.message}`);
    continue;
  }
  if (!doc || typeof doc !== "object" || !doc.services) {
    fail(`${rel}: کلید «services» یافت نشد`);
    continue;
  }
  const names = Object.keys(doc.services);
  servicesByFile.set(rel, new Set(names));

  const composeDir = path.dirname(abs);
  for (const [name, svc] of Object.entries(doc.services)) {
    if (!svc || typeof svc !== "object") {
      fail(`${rel}#${name}: تعریف سرویس نامعتبر است`);
      continue;
    }
    if (!svc.image && !svc.build) {
      fail(`${rel}#${name}: نه image دارد و نه build`);
    }

    // build.dockerfile / build.context
    if (svc.build) {
      const b = typeof svc.build === "string" ? { context: svc.build } : svc.build;
      const ctx = path.resolve(composeDir, b.context ?? ".");
      if (!fs.existsSync(ctx)) {
        fail(`${rel}#${name}: build.context وجود ندارد → ${b.context}`);
      }
      if (typeof svc.build === "object" && b.dockerfile) {
        const df = path.resolve(ctx, b.dockerfile);
        if (!fs.existsSync(df)) {
          fail(`${rel}#${name}: dockerfile یافت نشد → ${b.dockerfile}`);
        }
      }
    }

    // depends_on به سرویس موجود
    const dep = svc.depends_on;
    const depNames = Array.isArray(dep) ? dep : dep ? Object.keys(dep) : [];
    for (const d of depNames) {
      if (!names.includes(d)) {
        fail(`${rel}#${name}: depends_on به سرویس تعریف‌نشده «${d}»`);
      }
    }

    // کوتاه‌نویسی رایج: named volume ↔ مسیر میزبان
    for (const v of svc.volumes ?? []) {
      if (typeof v !== "string") continue; // long syntax بررسي نمی‌شود
      const [host] = v.split(":");
      if (host.startsWith(".") || host.startsWith("/")) {
        const resolved = path.resolve(composeDir, host);
        if (!fs.existsSync(resolved)) {
          fail(`${rel}#${name}: مسیر mount وجود ندارد → ${host}`);
        }
      }
    }
  }

  // هر نام volume استفاده‌شده باید در بخش volumes تعریف شده باشد (و برعکس).
  const declared = new Set(Object.keys(doc.volumes ?? {}));
  const used = new Set();
  for (const svc of Object.values(doc.services)) {
    for (const v of svc?.volumes ?? []) {
      if (typeof v !== "string") continue;
      const [src] = v.split(":");
      if (src.startsWith(".") || src.startsWith("/")) continue;
      used.add(src);
    }
  }
  for (const u of used) {
    if (!declared.has(u)) fail(`${rel}: volume «${u}» استفاده شده اما تعریف نشده است`);
  }
}

// ── ۲) Nginx ↔ Compose ──────────────────────────────────────────────────────
const nginxConf = path.join(root, "infra/nginx/kolbe.conf");
if (!fs.existsSync(nginxConf)) {
  fail("infra/nginx/kolbe.conf: فایل وجود ندارد");
} else {
  const conf = fs.readFileSync(nginxConf, "utf8");
  const withoutComments = conf
    .split("\n")
    .map((line) => (line.trim().startsWith("#") ? "" : line))
    .join("\n");

  // upstreamها: نام بلوک → hostname:port
  const upstreamHosts = new Map();
  for (const m of withoutComments.matchAll(/upstream\s+([\w-]+)\s*\{([^}]*)\}/g)) {
    const host = m[2].match(/server\s+([\w.-]+):(\d+)/);
    if (host) upstreamHosts.set(m[1], { host: host[1], port: host[2] });
  }

  const prodServices = servicesByFile.get("infra/compose/docker-compose.prod.yml") ?? new Set();
  for (const [block, { host, port }] of upstreamHosts) {
    if (!prodServices.has(host)) {
      fail(
        `nginx: upstream «${block}» به میزبان «${host}:${port}» اشاره می‌کند که سرویس ` +
          `متناظری در docker-compose.prod.yml ندارد ← nginx در زمان بالا آمدن شکست می‌خورد`,
      );
    }
  }

  // هر proxy_pass باید به یک upstream تعریف‌شده اشاره کند یا URL معتبر باشد.
  for (const m of withoutComments.matchAll(/proxy_pass\s+([^;]+);/g)) {
    const target = m[1].trim();
    if (target.startsWith("$")) continue;
    if (target.startsWith("http://")) {
      const block = target.replace(/^https?:\/\//, "").split(/[/;]/)[0];
      if (!upstreamHosts.has(block) && !/^[\w.-]+:\d+$/.test(block)) {
        fail(`nginx: proxy_pass به «${block}» اشاره می‌کند که upstream تعریف‌شده نیست`);
      }
    }
  }

  // includeها باید به فایل‌های موجود اشاره کنند (فایل‌های داخل کانتینر از میزبان mount می‌شوند).
  for (const m of withoutComments.matchAll(/^\s*include\s+([^;]+);/gm)) {
    const inc = m[1].trim();
    if (inc.includes("*")) continue; // الگوی mime.types و مانند آن
    if (inc.startsWith("/etc/nginx/")) {
      const local = path.join(root, "infra/nginx", path.basename(inc));
      if (!fs.existsSync(local)) {
        fail(`nginx: include «${inc}» فایل متناظر در infra/nginx ندارد`);
      }
    }
  }

  // متغیرهایی که با map تعریف شده‌اند باید قبل از استفاده وجود داشته باشند.
  const mapped = new Set(
    [...withoutComments.matchAll(/map\s+\$[\w]+\s+\$(\w+)/g)].map((m) => m[1]),
  );
  const paramsFile = path.join(root, "infra/nginx/kolbe-proxy-params.conf");
  if (fs.existsSync(paramsFile)) {
    const params = fs.readFileSync(paramsFile, "utf8");
    // متغیرهای توکار nginx (با پیشوند) از بررسی مستثنا هستند؛ فقط متغیرهای
    // سفارشیِ ساخته‌شده با `map` باید واقعاً map داشته باشند.
    const BUILTIN_PREFIXES = [
      "http_", "proxy_", "arg_", "cookie_", "sent_", "upstream_", "ssl_",
      "request_", "time_", "document_", "server_", "hostname", "binary_",
    ];
    const BUILTIN_EXACT = new Set([
      "host", "scheme", "uri", "args", "is_args", "query_string", "remote_addr",
      "remote_port", "remote_user", "request", "status", "request_uri", "document_root",
      "connection", "connection_requests", "request_time", "request_length",
      "content_length", "content_type", "bytes_sent", "body_bytes_sent",
      "msec", "nginx_version", "pid", "realpath_root", "limit_rate", "https", "request_id",
    ]);
    for (const m of params.matchAll(/\$(\w+)/g)) {
      const v = m[1];
      if (BUILTIN_EXACT.has(v)) continue;
      if (BUILTIN_PREFIXES.some((p) => v.startsWith(p))) continue;
      if (!mapped.has(v)) {
        fail(`nginx: kolbe-proxy-params.conf از متغیر «$${v}» استفاده می‌کند که map ندارد`);
      }
    }
  }

  // فاز ۱.۳: بررسی سلامت Nginx (liveness)
  if (!conf.includes("location = /healthz") && !conf.includes("location /healthz")) {
    fail("nginx: /healthz برای liveness تعریف نشده است (باید بدون وابستگی به upstream باشد)");
  }
  // بررسی nested location غیرمجاز (قبلاً /api/v1/auth/login داخل /api/v1/ بود)
  if (/location\s+\/api\/v1\/\s*\{[^}]*location\s+\/api\/v1\/auth\/login/s.test(conf)) {
    fail("nginx: location تو در تو برای /api/v1/auth/login — باید در سطح server جدا باشد");
  }
}

// ── ۲.۵) Dockerfile — بررسی‌های ایستای فاز ۱.۳ ───────────────────────────────
const dockerfiles = [
  "infra/docker/api.Dockerfile",
  "infra/docker/storefront.Dockerfile",
  "infra/docker/portal.Dockerfile",
];
for (const rel of dockerfiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    fail(`${rel}: فایل وجود ندارد`);
    continue;
  }
  const content = fs.readFileSync(abs, "utf8");
  // باید USER non-root داشته باشد
  if (!content.includes("USER ")) {
    fail(`${rel}: کاربر غیرروت (USER) تعریف نشده است`);
  }
  // healthcheck باید وجود داشته باشد
  if (!content.toLowerCase().includes("healthcheck")) {
    notes.push(`${rel}: HEALTHCHECK ندارد (اختیاری ولی توصیه می‌شود)`);
  }
  // بررسی‌های خاص storefront
  if (rel.includes("storefront")) {
    if (!content.includes("--workspaces")) {
      fail(`${rel}: باید npm ci با --workspaces اجرا کند تا next پیدا شود`);
    }
    if (!content.includes("packages/database")) {
      fail(`${rel}: باید packages/database را کپی کند (نگهبان اسکیما)`);
    }
    if (!content.includes("migrations")) {
      fail(`${rel}: باید migrations را کپی کند تا resolveMigrationsDir کار کند`);
    }
  }
  // بررسی api
  if (rel.includes("api.Dockerfile")) {
    if (!content.includes("migrations")) {
      fail(`${rel}: باید migrations را کپی کند`);
    }
  }
}

// ── ۲.۶) Compose — بررسی‌های تکمیلی فاز ۱.۳ ───────────────────────────────────
for (const rel of composeFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, "utf8");
  // minio healthcheck نباید از mc استفاده کند — بررسی دقیق‌تر: فقط در بخش healthcheck
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  if (rel.includes("dev") && withoutComments.includes('["CMD", "mc"')) {
    fail(`${rel}: healthcheck minio از mc استفاده می‌کند که در image رسمی minio نیست — باید curl/wget باشد`);
  }
  // prod: migrate نباید S3 لازم داشته باشد
  if (rel.includes("prod")) {
    const hasMigrateEnv = text.includes("migrate:");
    if (hasMigrateEnv) {
      // بررسی اینکه migrate از *api-env که S3 می‌خواهد استفاده نکند
      const migrateBlock = text.split("migrate:")[1]?.split("\n  ")[0] ?? "";
      // ساده: اگر migrate از *api-env استفاده کند و api-env شامل S3 باشد، هشدار
      // اما ما در فاز ۱.۳ آن را به *migrate-env جدا کردیم — پس چک می‌کنیم که migrate-env وجود دارد
      if (!text.includes("migrate-env") && text.includes("environment: *api-env")) {
        // این حالت قدیمی است که S3 را برای migrate هم الزامی می‌کرد
        notes.push(`${rel}: migrate از *api-env استفاده می‌کند که S3 را الزامی می‌کند — بهتر است *migrate-env جدا باشد`);
      }
    }
    // nginx depends_on باید service_healthy باشد
    if (text.includes("nginx:") && !text.includes("condition: service_healthy")) {
      notes.push(`${rel}: nginx depends_on بدون condition service_healthy — در فاز ۱.۳ اصلاح شد`);
    }
  }
}

// ── ۳) متغیرهای محیطی ↔ .env.example ────────────────────────────────────────
const envExample = path.join(root, "infra/.env.example");
if (!fs.existsSync(envExample)) {
  fail("infra/.env.example: فایل وجود ندارد");
} else {
  const documented = new Set(
    fs
      .readFileSync(envExample, "utf8")
      .split("\n")
      .map((l) => l.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
      .filter(Boolean),
  );
  const required = new Set();
  for (const rel of composeFiles) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    // ${VAR} و ${VAR:?…} و ${VAR:-…}
    for (const m of text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) required.add(m[1]);
  }
  for (const v of required) {
    if (!documented.has(v)) {
      fail(`infra/.env.example متغیر «${v}» را که Compose لازم دارد مستند نکرده است`);
    }
  }
  notes.push(`متغیرهای محیطی بررسی‌شده: ${required.size}`);
}
notes.push(`سرویس‌های Compose بررسی‌شده: ${[...servicesByFile.values()].reduce((n, s) => n + s.size, 0)}`);

// ── گزارش ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error("\n✖ مشکلات زیرساخت:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`\n${problems.length} مشکل یافت شد.`);
  process.exit(1);
}
console.log("✔ بازبینی ایستای زیرساخت موفق بود.");
for (const n of notes) console.log(`  · ${n}`);
console.log(
  "\n⚠️ یادآوری: این بازبینی فقط ساختار را بررسی می‌کند. ساخت imageها، اجرای " +
    "Compose و `nginx -t` همچنان باید روی میزبان دارای Docker انجام شود.",
);
