import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RatingsService } from "../src/modules/ratings/ratings.service";

/**
 * Phase 5.10-D7 — search/discovery/ratings concurrency (Nest e2e).
 *
 * Racing filings collapse to one review + one honest 409; racing
 * hide + show converge with the audit trail telling the order;
 * view bumps are exactly-once per hit under ×50; flags and
 * updates are idempotent / last-writer-wins without lost rows;
 * paged walks terminate valid under concurrent writes. Real
 * PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_10_d_concurrency_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let catalog: CatalogService;
let ratings: RatingsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r510d_${Date.now()}_${seq++}`;

const users = {} as Record<string, string>;
const ids = {} as Record<string, string>;

const as = (name: string, role: string) => ({ actorId: users[name], actorRole: role });
const codeOf = (error: any): string => error?.code ?? error?.response?.code ?? "NO_CODE";

async function wholesaleProof(buyer: string, productTag: string) {
  const accId = makeId("wacc");
  await db.insert(schema.wholesaleAccount).values({ id: accId, userId: users[buyer], memberName: "M", storeName: "S", phone: "09120000000", city: "تهران" });
  const orderId = makeId("word");
  await db.insert(schema.wholesaleOrder).values({
    id: orderId, orderCode: `WO-${seq}`, accountId: accId, buyerUserId: users[buyer], totalUnits: 1, version: 0, status: "completed",
  } as any);
  await db.insert(schema.wholesaleOrderItem).values({
    id: makeId("witem"), orderId, productId: ids[productTag], sellerId: ids.kolbe, productName: productTag, sku: `SKU-${productTag}`, quantity: 1,
  } as any);
}

describe("Phase 5.10-D7 concurrency", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p510d-concurrency";
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
    ratings = app.get(RatingsService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["custC", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }

    const offers = app.get(OffersService);
    ids.kolbe = await offers.ensureSeller(null, "KOLBE");

    const product = async (tag: string, name: string) => {
      ids[tag] = makeId(`prod_${tag}`);
      await db.insert(schema.product).values({ id: ids[tag], name, slug: `r510d-${tag}-${ids[tag]}`, status: "published", ownerType: "KOLBE" } as any);
      const vid = makeId(`var_${tag}`);
      await db.insert(schema.productVariant).values({ id: vid, productId: ids[tag], sku: `SKU-${vid}`, status: "active", attributes: {} as any });
      await db.insert(schema.sellerOffer).values({
        id: makeId("offer"), productId: ids[tag], sellerId: ids.kolbe, variantId: vid,
        sku: `OFFER-${seq}`, status: "published", retailPrice: 100000n as any, wholesalePrice: 80000n as any, currency: "IRR",
      });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: vid, sellerId: ids.kolbe, onHand: 10, reserved: 0, status: "active" });
    };
    await product("r1", "مسابقه یک");
    await product("r2", "مسابقه دو");
    await product("r3", "مسابقه سه");
    await product("r4", "مسابقه چهار");
    await product("r5", "مسابقه پنج");
    for (const buyer of ["custA", "custB", "custC"]) {
      for (const tag of ["r1", "r2", "r3", "r4", "r5"]) {
        await wholesaleProof(buyer, tag);
      }
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

  it("collapses racing duplicate filings to one review + one 409", async () => {
    const [a, b] = await Promise.allSettled([
      ratings.fileReview(as("custA", "customer"), ids.r1, { rating: 5, review: "اول" }),
      ratings.fileReview(as("custA", "customer"), ids.r1, { rating: 1, review: "دوم" }),
    ]);
    const won = [a, b].filter((r) => r.status === "fulfilled");
    const lost = [a, b].filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(codeOf((lost[0] as PromiseRejectedResult).reason)).toBe("REVIEW_ALREADY_EXISTS");
    const rows = await db.select().from(schema.productRating).where(eq(schema.productRating.productId, ids.r1));
    expect(rows).toHaveLength(1);
  });

  it("converges racing hide + show with the audit trail telling the order", async () => {
    const filed = await ratings.fileReview(as("custA", "customer"), ids.r2, { rating: 4 });
    const [a, b] = await Promise.allSettled([
      ratings.setReviewVisibility(as("admin", "admin"), filed.id as string, false),
      ratings.setReviewVisibility(as("admin", "admin"), filed.id as string, true),
    ]);
    // Idempotent moderations never refuse: both report success.
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, filed.id as string));
    const audits = (await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, filed.id as string))).sort(
      (x: any, y: any) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
    ) as any[];
    // One or two real transitions happened; the trail's last word
    // always matches the row. A hide→show and show→hide pair leaves
    // two rows; a swallowed race (second sees the first's state and
    // no-ops... it can't — opposite intents always differ) — either
    // way the invariant is trail-last == row.
    expect([1, 2]).toContain(audits.length);
    expect((audits[audits.length - 1].after as any).status).toBe((row as any).status);
  });

  it("counts every concurrent detail hit exactly once (×50)", async () => {
    const [before] = await db.select().from(schema.product).where(eq(schema.product.id, ids.r3));
    await Promise.all(Array.from({ length: 50 }, () => catalog.getProductDetail(ids.r3, "retail")));
    const [after] = await db.select().from(schema.product).where(eq(schema.product.id, ids.r3));
    expect((after as any).viewCount).toBe((before as any).viewCount + 50);
  });

  it("keeps racing flags idempotent on a single flagged row", async () => {
    const filed = await ratings.fileReview(as("custA", "customer"), ids.r4, { rating: 3 });
    const results = await Promise.allSettled([
      ratings.flagReview(as("custB", "customer"), filed.id as string),
      ratings.flagReview(as("custC", "customer"), filed.id as string),
      ratings.flagReview(as("custB", "customer"), filed.id as string),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, filed.id as string));
    expect((row as any).status).toBe("flagged");
  });

  it("serializes racing owner updates without losing the row", async () => {
    const filed = await ratings.fileReview(as("custA", "customer"), ids.r5, { rating: 5 });
    const [a, b] = await Promise.allSettled([
      ratings.updateReview(as("custA", "customer"), filed.id as string, { rating: 1, review: "بد" }),
      ratings.updateReview(as("custA", "customer"), filed.id as string, { rating: 2, review: "متوسط" }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, filed.id as string));
    // Last-writer-wins between two full-row writes: the survivor is
    // one of the two honest payloads, never a mix or a loss.
    expect([[1, "بد"], [2, "متوسط"]]).toContainEqual([(row as any).rating, (row as any).review]);
  });

  it("walks the review keyset cleanly while filings land concurrently", async () => {
    const writers = ["custA", "custB", "custC"].map((buyer, n) =>
      ratings.fileReview(as(buyer, "customer"), ids.r3, { rating: n + 1 }),
    );
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    const [, ..._rest] = await Promise.all([
      (async () => {
        do {
          const page = await ratings.listReviews(ids.r3, { limit: 1, cursor });
          pages += 1;
          for (const row of page.reviews) seen.push(row.id as string);
          cursor = page.nextCursor ?? undefined;
        } while (cursor && pages < 10);
      })(),
      ...writers,
    ]);
    expect(pages).toBeLessThan(10);
    expect(new Set(seen).size).toBe(seen.length); // no dupes within the walk
    const rows = await db.select().from(schema.productRating).where(eq(schema.productRating.productId, ids.r3));
    expect(rows).toHaveLength(3);
  });

  it("pages search cleanly while products land concurrently", async () => {
    const inserts = Array.from({ length: 5 }, (_, n) =>
      (async () => {
        const pid = makeId(`prod_churn${n}`);
        await db.insert(schema.product).values({ id: pid, name: `مسابقه churn ${n}`, slug: `churn-${pid}`, status: "published", ownerType: "KOLBE" } as any);
      })(),
    );
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    await Promise.all([
      (async () => {
        do {
          const page = await catalog.searchProducts("churn", "retail", { limit: 2, cursor });
          pages += 1;
          for (const row of page.results) seen.push(row.id as string);
          cursor = page.nextCursor ?? undefined;
        } while (cursor && pages < 10);
      })(),
      ...inserts,
    ]);
    expect(pages).toBeLessThan(10);
    expect(new Set(seen).size).toBe(seen.length);
    // Every row the walk saw genuinely matches.
    for (const id of seen) {
      const [row] = await db.select().from(schema.product).where(eq(schema.product.id, id));
      expect((row as any).name).toContain("churn");
    }
  });
});
