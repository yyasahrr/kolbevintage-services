import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { cmsPageRevision } from "@kolbe/database";
import { CmsPageService } from "../src/modules/cms/cms-page.service";
import { CmsPublicationService } from "../src/modules/cms/cms-publication.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_4_service_test";
let pool: Pool;
let pages: CmsPageService;
let publication: CmsPublicationService;

const audit = { record: async () => "audit_test" };
const lock = { withSessionLock: async (_key: string, fn: () => Promise<unknown>) => ({ executed: true, result: await fn(), lockKey: _key }) };

describe("Phase 5.4 CMS service lifecycle", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    pages = new CmsPageService(db as any, audit as any);
    publication = new CmsPublicationService(db as any, audit as any, lock as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("creates immutable revisions, publishes one pointer, supersedes the old revision, and rolls back as a new revision", async () => {
    const created = await pages.createPage({ stableKey: "phase54-home", pageType: "HOME", routePath: "/فروشگاه-کلبه", title: "خانه", blocks: [{ type: "CUSTOM_TEXT", payload: { text: "نسخه یک" } }] });
    const first = created.revision;
    await publication.publishPage(first.id, null);
    const next = await pages.createRevision({ pageId: created.page.id, title: "خانه جدید", blocks: [{ type: "CUSTOM_TEXT", payload: { text: "نسخه دو" } }] });
    await publication.publishPage(next.id, null);
    const revisions = await pages.listRevisions(created.page.id);
    expect(revisions.find((revision) => revision.id === first.id)?.status).toBe("SUPERSEDED");
    expect(revisions.find((revision) => revision.id === next.id)?.status).toBe("PUBLISHED");

    const rollback = await pages.rollback(created.page.id, first.id, null);
    expect(rollback.id).not.toBe(first.id);
    expect(rollback.sourceRevisionId).toBe(first.id);
    await publication.publishPage(rollback.id, null);
    const [current] = await (pages as any).db.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, rollback.id));
    expect(current.status).toBe("PUBLISHED");
  });
});
