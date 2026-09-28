import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePostgres, recreateDatabase, dropDatabase, migrateOrFail, withClient, expectSqlViolation } from "./helpers";

const DB = "kolbe_phase_5_4_cms_test";

describe("Phase 5.4 CMS PostgreSQL invariants", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);
  afterAll(() => dropDatabase(DB));

  it("creates CMS identity, taxonomy and all revision tables on real PostgreSQL", async () => {
    await withClient(DB, async (client) => {
      const { rows } = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'cms_%'");
      const names = new Set(rows.map((row) => row.table_name));
      for (const name of ["cms_page", "cms_page_revision", "cms_content_document", "cms_content_revision", "cms_navigation", "cms_navigation_revision", "cms_media_asset", "cms_media_usage", "cms_article", "cms_article_taxonomy", "cms_article_revision", "cms_article_revision_taxonomy", "cms_publication_schedule"]) expect(names.has(name), name).toBe(true);
    });
  });

  it("enforces immutable revision content, one published pointer, and foreign keys", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("INSERT INTO cms_page (id,stable_key,page_type,route_path) VALUES ('page_test','home','HOME','/cms-test')");
        await client.query("INSERT INTO cms_page_revision (id,page_id,version,title,blocks,seo_metadata) VALUES ('page_rev_1','page_test',1,'اول','[]','{}')");
        await expectSqlViolation(client, "UPDATE cms_page_revision SET title='tampered' WHERE id='page_rev_1'", "P0001");
        await expectSqlViolation(client, "DELETE FROM cms_page_revision WHERE id='page_rev_1'", "P0001");
        await client.query("UPDATE cms_page_revision SET status='PUBLISHED',published_at=now() WHERE id='page_rev_1'");
        await client.query("INSERT INTO cms_page_revision (id,page_id,version,title,blocks,seo_metadata) VALUES ('page_rev_2','page_test',2,'دو','[]','{}')");
        await expectSqlViolation(client, "UPDATE cms_page_revision SET status='PUBLISHED',published_at=now() WHERE id='page_rev_2'", "23505");
        await expectSqlViolation(client, "INSERT INTO cms_page_revision (id,page_id,version,title,blocks,seo_metadata) VALUES ('page_rev_bad','missing_page',1,'x','[]','{}')", "23503");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("rejects unsafe schedule shapes and media metadata at the database boundary", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      try {
        await expectSqlViolation(client, "INSERT INTO cms_publication_schedule (id,target_type,publish_at,idempotency_key) VALUES ('schedule_bad','PAGE_REVISION',now(),'bad')", "23514");
        await expectSqlViolation(client, "INSERT INTO cms_media_asset (id,storage_provider,object_key,original_filename,mime_type,byte_size,checksum_sha256) VALUES ('media_bad','LOCAL_PUBLIC','cms/bad','bad.jpg','image/jpeg',10,'not-a-checksum')", "23514");
        await expectSqlViolation(client, "INSERT INTO cms_article_taxonomy (id,taxonomy_key,slug,label,kind) VALUES ('term_bad','term','term','Term','UNKNOWN')", "23514");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});
