import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient, expectSqlViolation } from "./helpers";

const DB = "kolbe_phase44_test";

describe("Phase 4.4 — Supplier Revision, Fulfillment Exception & Child Isolation", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("wholesale_request status CHECK allows 8 states", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      // Insert minimal required rows
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u1','u1@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc1','u1','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO brand (id, name, slug, status) VALUES ('b1','Brand','brand-44','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO category (id, slug, name, status) VALUES ('c1','cat-44','Cat','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p1','Prod','prod-44','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup1','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller1','SUPPLIER','sup1','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off1','p1','seller1','SKU-44','published',1000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      // Valid statuses
      for (const st of ['pending','supplier_review','revision_requested','accepted','rejected','cancelled','expired','ordered']) {
        await client.query(`SAVEPOINT sp`);
        try {
          await client.query(`INSERT INTO wholesale_request (id, product_id, offer_id, vip_account_id, quantity, status, version) VALUES ('wreq_${st}','p1','off1','acc1',1,'${st}',0)`);
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT sp`);
          throw e;
        }
        await client.query(`RELEASE SAVEPOINT sp`);
      }
      // Invalid status should fail
      await expectSqlViolation(client, `INSERT INTO wholesale_request (id, product_id, offer_id, vip_account_id, quantity, status, version) VALUES ('wreq_invalid','p1','off1','acc1',1,'invalid_status',0)`, '23514');
      await client.query("ROLLBACK");
    });
  });

  it("wholesale_request_revision FKs and CHECKs", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_rev','u_rev@test.com','h','s','supplier','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_rev_buyer','u_rev_buyer@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_rev','u_rev_buyer','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO brand (id, name, slug, status) VALUES ('b_rev','Brand','brand-rev','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO category (id, slug, name, status) VALUES ('c_rev','cat-rev','Cat','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_rev','Prod','prod-rev','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_rev','p_rev','SKU-var-rev','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_rev','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_rev','SUPPLIER','sup_rev','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_rev','p_rev','seller_rev','SKU-off-rev','published',1000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_package (id, offer_id, package_type, name, total_pieces) VALUES ('pkg_rev','off_rev','SIZE_RUN','Pkg',12) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_request (id, product_id, offer_id, vip_account_id, quantity, status, version) VALUES ('wreq_rev','p_rev','off_rev','acc_rev',10,'supplier_review',0) ON CONFLICT DO NOTHING`);

      // Valid revision
      await client.query(`INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, reason, proposed_quantity, currency) VALUES ('rev1','wreq_rev',0,1,'u_rev','supplier','Need less',5,'IRR')`);

      // Duplicate revision_number should fail unique
      await expectSqlViolation(client, `INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, reason, currency) VALUES ('rev_dup','wreq_rev',0,1,'u_rev','supplier','Dup','IRR')`, '23505');

      // Invalid pricing_unit
      await expectSqlViolation(client, `INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, reason, pricing_unit, currency) VALUES ('rev_bad_unit','wreq_rev',0,2,'u_rev','supplier','Bad','INVALID','IRR')`, '23514');

      // Both variant and package set should fail selector CHECK
      await expectSqlViolation(client, `INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, proposed_variant_id, proposed_package_id, currency) VALUES ('rev_both','wreq_rev',0,3,'u_rev','supplier','var_rev','pkg_rev','IRR')`, '23514');

      // Negative revision_number
      await expectSqlViolation(client, `INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, currency) VALUES ('rev_neg','wreq_rev',0,0,'u_rev','supplier','IRR')`, '23514');

      // FK RESTRICT: cannot delete request while revision exists
      await expectSqlViolation(client, `DELETE FROM wholesale_request WHERE id='wreq_rev'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("fulfillment_exception FKs and CHECKs", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_exc','u_exc@test.com','h','s','supplier','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_exc','u_exc','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_exc','Prod','prod-exc','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_exc','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_exc','SUPPLIER','sup_exc','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_exc','KV-W-EXC','acc_exc','u_exc','processing','IRR',0,0,0,0,0,'{}','{}',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_exc','KV-W-EXC-01','seller_exc','sup_exc','wo_exc','preparing','IRR',1000,1000,1000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);

      // Valid exception
      await client.query(`INSERT INTO fulfillment_exception (id, child_order_id, seller_id, wholesale_order_id, type, reason, status, reported_by, affected_amount, currency) VALUES ('exc1','po_exc','seller_exc','wo_exc','cannot_fulfill','No stock','open','u_exc',1000,'IRR')`);

      // Invalid type
      await expectSqlViolation(client, `INSERT INTO fulfillment_exception (id, child_order_id, seller_id, type, status, reported_by, affected_amount, currency) VALUES ('exc_bad_type','po_exc','seller_exc','invalid_type','open','u_exc',0,'IRR')`, '23514');

      // Invalid status
      await expectSqlViolation(client, `INSERT INTO fulfillment_exception (id, child_order_id, seller_id, type, status, reported_by, affected_amount, currency) VALUES ('exc_bad_status','po_exc','seller_exc','cannot_fulfill','invalid','u_exc',0,'IRR')`, '23514');

      // Negative affected_amount
      await expectSqlViolation(client, `INSERT INTO fulfillment_exception (id, child_order_id, seller_id, type, status, reported_by, affected_amount, currency) VALUES ('exc_neg','po_exc','seller_exc','cannot_fulfill','open','u_exc',-1,'IRR')`, '23514');

      // bigint affected_amount > MAX_MONEY should fail
      await expectSqlViolation(client, `INSERT INTO fulfillment_exception (id, child_order_id, seller_id, type, status, reported_by, affected_amount, currency) VALUES ('exc_big','po_exc','seller_exc','cannot_fulfill','open','u_exc',2000000000000000,'IRR')`, '23514');

      // FK RESTRICT: cannot delete child while exception exists
      await expectSqlViolation(client, `DELETE FROM purchase_order WHERE id='po_exc'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("inventory_reservation.child_order_id FK RESTRICT no CASCADE", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_child','u_child@test.com','h','s','supplier','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_child','Prod','prod-child','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_child','p_child','SKU-child','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_child','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_child','SUPPLIER','sup_child','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant_inventory (id, variant_id, seller_id, on_hand, reserved, status) VALUES ('inv_child','var_child','seller_child',100,0,'active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_child','u_child','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_child','KV-W-CHILD','acc_child','u_child','processing','IRR',0,0,0,0,0,'{}','{}',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_child','KV-W-CHILD-01','seller_child','sup_child','wo_child','pending','IRR',1000,1000,1000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO inventory_reservation (id, variant_id, seller_id, quantity, status, order_id, child_order_id) VALUES ('res_child','var_child','seller_child',5,'active','wo_child','po_child')`);

      // Cannot delete child while reservation exists (RESTRICT)
      await expectSqlViolation(client, `DELETE FROM purchase_order WHERE id='po_child'`, '23503');

      // Delete reservation then child should succeed
      await client.query(`DELETE FROM inventory_reservation WHERE id='res_child'`);
      await client.query(`DELETE FROM purchase_order WHERE id='po_child'`);
      // Should be gone
      const { rows } = await client.query(`SELECT COUNT(*) as c FROM purchase_order WHERE id='po_child'`);
      expect(Number(rows[0].c)).toBe(0);

      await client.query("ROLLBACK");
    });
  });

  it("revision uniqueness and buyer_response CHECK", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_uni','u_uni@test.com','h','s','supplier','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_uni_buyer','u_uni_buyer@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_uni','u_uni_buyer','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_uni','Prod','prod-uni','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_uni','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_uni','SUPPLIER','sup_uni','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_uni','p_uni','seller_uni','SKU-uni','published',1000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_request (id, product_id, offer_id, vip_account_id, quantity, status, version) VALUES ('wreq_uni','p_uni','off_uni','acc_uni',10,'supplier_review',0) ON CONFLICT DO NOTHING`);

      await client.query(`INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, currency) VALUES ('rev_uni1','wreq_uni',0,1,'u_uni','supplier','IRR')`);
      await client.query(`INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, currency) VALUES ('rev_uni2','wreq_uni',0,2,'u_uni','supplier','IRR')`);

      // buyer_response invalid
      await expectSqlViolation(client, `INSERT INTO wholesale_request_revision (id, request_id, request_version, revision_number, proposed_by_user_id, proposed_by_role, buyer_response, currency) VALUES ('rev_bad_resp','wreq_uni',0,3,'u_uni','supplier','invalid','IRR')`, '23514');

      await client.query("ROLLBACK");
    });
  });
});
