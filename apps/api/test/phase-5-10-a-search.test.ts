import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { CatalogService } from "../src/modules/catalog/catalog.service";

/**
 * Phase 5.10-A — server-side search (Nest e2e).
 *
 * Relevance tiers are deterministic (exact > prefix > contains /
 * similar > slug-brand-category), Persian queries match with
 * Yeh/Kaf folding, typos recall via trigram similarity, the
 * channel fence hides supplier + draft rows from retail,
 * pagination is a keyset with no dupes or skips, and hostile
 * input is parameterized, never interpolated. Real PostgreSQL
 * with pg_trgm, full Nest application, real CatalogService.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_10_a_search_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let catalog: CatalogService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r510a_${Date.now()}_${seq++}`;
const stamp = Date.now().toString(36);

const ids = {} as Record<string, string>;
const scoreOf = (rows: Array<Record<string, unknown>>, id: string) => rows.find((row) => row.id === id)?.score as number | undefined;

describe("Phase 5.10-A search", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      // Unicode CTYPE: pg_trgm cannot tokenize Persian under C (see 0040).
      await adminClient.query(`CREATE DATABASE "${TEST_DB}" TEMPLATE template0 LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8'`);
    } finally {
      await adminClient.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p510a-search";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    catalog = app.get(CatalogService);

    const brandId = makeId("brand");
    await db.insert(schema.brand).values({ id: brandId, name: "مس‌گران", slug: `mesgaran-${stamp}`, status: "active" });
    const product = async (tag: string, row: Record<string, unknown>) => {
      ids[tag] = makeId(`prod_${tag}`);
      await db.insert(schema.product).values({ id: ids[tag], status: "published", ownerType: "KOLBE", ...row } as any);
    };
    await product("exact", { name: "کتری مسی", slug: `ketri-masi-${stamp}` });
    await product("prefix", { name: "کتری مسی دسته‌دار", slug: `ketri-dastedar-${stamp}` });
    await product("contains", { name: "قوری چای به‌همراه کتری سفری", slug: `ghouri-ketri-${stamp}` });
    await product("typo", { name: "سماور نفتی برنجی", slug: `samovar-${stamp}` });
    await product("supplier", { name: "کتری مسی صادراتی", slug: `ketri-export-${stamp}`, ownerType: "SUPPLIER" });
    await product("draft", { name: "کتری مسی پیش‌نویس", slug: `ketri-draft-${stamp}`, status: "draft" });
    await product("brand", { name: "ظرف پذیرایی", slug: `zarf-${stamp}`, brandId });
    await product("fold", { name: "کیف چرمی", slug: `kif-${stamp}` });
    for (let n = 1; n <= 60; n++) {
      await product(`bulk${n}`, { name: `دکوری ${n}`, slug: `decor-${stamp}-${n}` });
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await adminClient.end();
    }
  });

  it("ranks the exact name first with score 1000", async () => {
    const { results, nextCursor } = await catalog.searchProducts("کتری مسی", "retail");
    expect(results[0].id).toBe(ids.exact);
    expect(results[0].score).toBe(1000);
    expect(nextCursor).toBeNull();
  });

  it("tiers prefix above contains for a shared stem", async () => {
    const { results } = await catalog.searchProducts("کتری", "retail");
    const found = results.map((row) => row.id as string);
    expect(found).toContain(ids.exact);
    expect(found).toContain(ids.prefix);
    expect(found).toContain(ids.contains);
    // Both prefix-tier rows outscore the contains-tier row.
    expect(scoreOf(results, ids.exact)).toBeGreaterThan(500);
    expect(scoreOf(results, ids.prefix)).toBeGreaterThan(500);
    expect(scoreOf(results, ids.contains)).toBeLessThan(500);
    expect(scoreOf(results, ids.contains)).toBeGreaterThan(100);
  });

  it("recalls through a typo the substring match cannot see", async () => {
    const typoQuery = "سماور نفت برنجی"; // dropped ی breaks every substring
    expect("سماور نفتی برنجی".includes(typoQuery)).toBe(false);
    const { results } = await catalog.searchProducts(typoQuery, "retail");
    const score = scoreOf(results, ids.typo);
    expect(score).toBeGreaterThan(100);
    expect(score).toBeLessThan(500);
  });

  it("folds Arabic Yeh/Kaf onto Persian before matching", async () => {
    const arabicQuery = "كيف چرمي"; // U+064A/U+0643 where the row holds U+06CC/U+06A9
    expect("کیف چرمی".includes(arabicQuery)).toBe(false);
    const { results } = await catalog.searchProducts(arabicQuery, "retail");
    expect(results[0].id).toBe(ids.fold);
    expect(results[0].score).toBe(1000);
  });

  it("matches through the brand name in the lowest tier", async () => {
    const { results } = await catalog.searchProducts("مس‌گران", "retail");
    expect(scoreOf(results, ids.brand)).toBe(110);
  });

  it("fences channels: retail hides supplier rows, drafts hide everywhere", async () => {
    const retail = await catalog.searchProducts("کتری", "retail");
    const retailIds = retail.results.map((row) => row.id);
    expect(retailIds).not.toContain(ids.supplier);
    expect(retailIds).not.toContain(ids.draft);
    const wholesale = await catalog.searchProducts("کتری", "wholesale");
    const wholesaleIds = wholesale.results.map((row) => row.id);
    expect(wholesaleIds).toContain(ids.supplier);
    expect(wholesaleIds).not.toContain(ids.draft);
  });

  it("walks the keyset with no dupes, no skips, and a terminating cursor", async () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let lastNext: string | null = "unfinished";
    let pages = 0;
    do {
      const page = await catalog.searchProducts("دکوری", "retail", { limit: 25, cursor });
      pages += 1;
      for (const row of page.results) seen.push(row.id as string);
      lastNext = page.nextCursor;
      cursor = page.nextCursor ?? undefined;
    } while (cursor && pages < 10);
    expect(pages).toBe(3); // 25 + 25 + 10
    expect(new Set(seen).size).toBe(60);
    expect(seen).toHaveLength(60);
    expect(lastNext).toBeNull(); // the final page terminates the walk
  });

  it("clamps runaway limits at 50 and heals garbage limits to the default", async () => {
    const capped = await catalog.searchProducts("دکوری", "retail", { limit: 200 });
    expect(capped.results).toHaveLength(50);
    expect(capped.nextCursor).not.toBeNull();
    const healed = await catalog.searchProducts("دکوری", "retail", { limit: "banana" });
    expect(healed.results).toHaveLength(20);
    const zero = await catalog.searchProducts("دکوری", "retail", { limit: 0 });
    expect(zero.results).toHaveLength(1);
  });

  it("returns empty for blank queries without scanning", async () => {
    for (const q of ["", "   ", "\t\n"]) {
      const page = await catalog.searchProducts(q, "retail");
      expect(page).toEqual({ results: [], nextCursor: null });
    }
  });

  it("parameterizes hostile input: no rows, no damage", async () => {
    const before = await db.select({ id: schema.product.id }).from(schema.product);
    const page = await catalog.searchProducts("'; DROP TABLE product; --", "retail");
    expect(page.results).toHaveLength(0);
    const after = await db.select({ id: schema.product.id }).from(schema.product);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    const wildcards = await catalog.searchProducts("%_%", "retail");
    expect(wildcards.results).toHaveLength(0);
  });

  it("orders deterministically across runs and refuses malformed cursors", async () => {
    const a = await catalog.searchProducts("کتری", "retail");
    const b = await catalog.searchProducts("کتری", "retail");
    expect(b.results.map((row) => row.id)).toEqual(a.results.map((row) => row.id));
    await expect(catalog.searchProducts("کتری", "retail", { cursor: "!!!" })).rejects.toMatchObject({ code: "SEARCH_CURSOR_INVALID" });
  });

  it("serves the public HTTP shape with channel + pagination params", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ q: "کتری مسی", channel: "retail", limit: 2 })
      .expect(200);
    expect(res.body.results[0].id).toBe(ids.exact);
    expect(Object.keys(res.body).sort()).toEqual(["nextCursor", "results"]);
    const anon = await request(app.getHttpServer()).get("/api/v1/catalog/products").query({ q: "کتری" }).expect(200);
    expect(anon.body.results.length).toBeGreaterThan(0);
  });
});
