import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase39_test";

describe("Phase 3.9 marketplace database hardening", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);

  afterAll(async () => dropDatabase(DB));

  it("keeps legacy commerce tables absent and adds a submission, not a product clone", async () => {
    const { rows } = await withClient(DB, (client) => client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name='supplier_product_submission' OR table_name IN ('supplier_product','supplier_variant','supplier_inventory')) ORDER BY table_name`,
    ));
    expect(rows.map((row) => row.table_name)).toEqual(["supplier_product_submission"]);
  });

  it("database rejects a second KOLBE seller and supplier seller without supplier", async () => {
    await withClient(DB, async (client) => {
      await expect(client.query(`INSERT INTO seller(id,type,display_name) VALUES ('kolbe_second','KOLBE','Second')`)).rejects.toMatchObject({ code: "23505" });
      await expect(client.query(`INSERT INTO seller(id,type,display_name) VALUES ('supplier_invalid','SUPPLIER','Invalid')`)).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("database rejects zero MOQ, package quantities and invalid tier ranges", async () => {
    const { rows } = await withClient(DB, (client) => client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname IN ('seller_offer_moq_positive','wholesale_package_total_pieces_positive','wholesale_package_item_quantity_positive','wholesale_pricing_tier_min_quantity_positive','wholesale_pricing_tier_range_valid','wholesale_request_quantity_positive') ORDER BY conname`,
    ));
    expect(rows).toHaveLength(6);
  });

  it("CHECK helper calls use physical snake_case column names", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/schema/tables.ts"), "utf8");
    const helperCalls = [...source.matchAll(/(?:stateCheck|moneyCheck|quantityCheck|positiveQuantityCheck)\([^\n]*?,\s*"([^"]+)"/g)];
    const camelCase = helperCalls.map((match) => match[1]).filter((column) => /[A-Z]/.test(column));
    expect(camelCase).toEqual([]);
  });
});
