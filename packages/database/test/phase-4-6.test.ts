import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient, expectSqlViolation } from "./helpers";

const DB = "kolbe_phase46_test";

describe("Phase 4.6 — Wholesale Finance Foundation", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("wholesale_proforma CHECKs and unique constraints", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_prof','u_prof@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_prof','u_prof','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_prof','Prod','prod-prof','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_prof','p_prof','SKU-prof','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_a','Sup A','Sup A','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_b','Sup B','Sup B','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_a','SUPPLIER','sup_a','Seller A','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_b','SUPPLIER','sup_b','Seller B','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, display_name, status) VALUES ('seller_kolbe','KOLBE','KOLBE','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_a','p_prof','seller_a','SKU-off-a','published',20000000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_b','p_prof','seller_b','SKU-off-b','published',15000000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_kolbe','p_prof','seller_kolbe','SKU-kolbe','published',10000000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_prof','KV-W-PROF','acc_prof','u_prof','confirmed','IRR',45000000,0,45000000,45000000,3,'{}','{}',1) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_kolbe','KV-W-PROF-01','seller_kolbe',NULL,'wo_prof','pending','IRR',10000000,10000000,10000000,'KOLBE',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_a','KV-W-PROF-02','seller_a','sup_a','wo_prof','pending','IRR',20000000,20000000,20000000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_b','KV-W-PROF-03','seller_b','sup_b','wo_prof','pending','IRR',15000000,15000000,15000000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order_item (id, order_id, product_id, variant_id, seller_offer_id, seller_id, supplier_id, product_name, sku, quantity, piece_quantity, unit_price, line_total, currency, product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot) VALUES ('woi_kolbe','wo_prof','p_prof','var_prof','off_kolbe','seller_kolbe',NULL,'Prod','SKU-prof',1,1,10000000,10000000,'IRR','Prod','SKU-prof','{}','{}') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order_item (id, order_id, product_id, variant_id, seller_offer_id, seller_id, supplier_id, product_name, sku, quantity, piece_quantity, unit_price, line_total, currency, product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot) VALUES ('woi_a','wo_prof','p_prof','var_prof','off_a','seller_a','sup_a','Prod','SKU-prof',1,1,20000000,20000000,'IRR','Prod','SKU-prof','{}','{}') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order_item (id, order_id, product_id, variant_id, seller_offer_id, seller_id, supplier_id, product_name, sku, quantity, piece_quantity, unit_price, line_total, currency, product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot) VALUES ('woi_b','wo_prof','p_prof','var_prof','off_b','seller_b','sup_b','Prod','SKU-prof',1,1,15000000,15000000,'IRR','Prod','SKU-prof','{}','{}') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order_item (id, purchase_order_id, wholesale_order_item_id, product_id, variant_id, seller_offer_id, product_name, sku, quantity, unit_price, total_amount) VALUES ('poi_kolbe','po_kolbe','woi_kolbe','p_prof','var_prof','off_kolbe','Prod','SKU-prof',1,10000000,10000000) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order_item (id, purchase_order_id, wholesale_order_item_id, product_id, variant_id, seller_offer_id, product_name, sku, quantity, unit_price, total_amount) VALUES ('poi_a','po_a','woi_a','p_prof','var_prof','off_a','Prod','SKU-prof',1,20000000,20000000) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order_item (id, purchase_order_id, wholesale_order_item_id, product_id, variant_id, seller_offer_id, product_name, sku, quantity, unit_price, total_amount) VALUES ('poi_b','po_b','woi_b','p_prof','var_prof','off_b','Prod','SKU-prof',1,15000000,15000000) ON CONFLICT DO NOTHING`);

      // Valid proformas: one per active child KOLBE 10M + A 20M + B 15M
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_kolbe','PROF-KOLBE-001','wo_prof','po_kolbe','seller_kolbe',NULL,1,'issued','IRR',10000000,0,10000000,'{}')`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_a','PROF-A-001','wo_prof','po_a','seller_a','sup_a',1,'issued','IRR',20000000,0,20000000,'{}')`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_b','PROF-B-001','wo_prof','po_b','seller_b','sup_b',1,'issued','IRR',15000000,0,15000000,'{}')`);

      // Unique proforma_number violation
      await expectSqlViolation(client, `INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_dup','PROF-KOLBE-001','wo_prof','po_kolbe','seller_kolbe',1,'draft','IRR',0,0,0,'{}')`, '23505');

      // One current active issued per child violation
      await expectSqlViolation(client, `INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_kolbe_dup','PROF-KOLBE-002','wo_prof','po_kolbe','seller_kolbe',1,'issued','IRR',10000000,0,10000000,'{}')`, '23505');

      // Invalid status
      await expectSqlViolation(client, `INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_bad_status','PROF-BAD-001','wo_prof','po_kolbe','seller_kolbe',1,'invalid','IRR',0,0,0,'{}')`, '23514');

      // Negative amount
      await expectSqlViolation(client, `INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_neg','PROF-NEG-001','wo_prof','po_kolbe','seller_kolbe',1,'draft','IRR',-1,0,0,'{}')`, '23514');

      // FK RESTRICT: cannot delete child while proforma exists
      await expectSqlViolation(client, `DELETE FROM purchase_order WHERE id='po_kolbe'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("wholesale_proforma_line FKs and CHECKs", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_line','u_line@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_line','u_line','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_line','Prod','prod-line','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_line','p_line','SKU-line','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_line','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_line','SUPPLIER','sup_line','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_line','p_line','seller_line','SKU-off-line','published',1000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_line','KV-W-LINE','acc_line','u_line','confirmed','IRR',1000,0,1000,1000,1,'{}','{}',1) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_line','KV-W-LINE-01','seller_line','sup_line','wo_line','pending','IRR',1000,1000,1000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order_item (id, order_id, product_id, variant_id, seller_offer_id, seller_id, supplier_id, product_name, sku, quantity, piece_quantity, unit_price, line_total, currency, product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot) VALUES ('woi_line','wo_line','p_line','var_line','off_line','seller_line','sup_line','Prod','SKU-line',1,1,1000,1000,'IRR','Prod','SKU-line','{}','{}') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order_item (id, purchase_order_id, wholesale_order_item_id, product_id, variant_id, seller_offer_id, product_name, sku, quantity, unit_price, total_amount) VALUES ('poi_line','po_line','woi_line','p_line','var_line','off_line','Prod','SKU-line',1,1000,1000) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_line','PROF-LINE-001','wo_line','po_line','seller_line','sup_line',1,'issued','IRR',1000,0,1000,'{}')`);

      // Valid line
      await client.query(`INSERT INTO wholesale_proforma_line (id, proforma_id, wholesale_order_item_id, purchase_order_item_id, description_snapshot, sku_snapshot, quantity, pricing_unit, unit_price, line_total, currency) VALUES ('profl1','prof_line','woi_line','poi_line','Prod','SKU-line',1,'PIECE',1000,1000,'IRR')`);

      // Quantity 0 should fail positive check
      await expectSqlViolation(client, `INSERT INTO wholesale_proforma_line (id, proforma_id, wholesale_order_item_id, description_snapshot, sku_snapshot, quantity, pricing_unit, unit_price, line_total, currency) VALUES ('profl_bad_qty','prof_line','woi_line','Prod','SKU-line',0,'PIECE',1000,1000,'IRR')`, '23514');

      // Invalid pricing_unit
      await expectSqlViolation(client, `INSERT INTO wholesale_proforma_line (id, proforma_id, wholesale_order_item_id, description_snapshot, sku_snapshot, quantity, pricing_unit, unit_price, line_total, currency) VALUES ('profl_bad_unit','prof_line','woi_line','Prod','SKU-line',1,'INVALID',1000,1000,'IRR')`, '23514');

      // FK RESTRICT: cannot delete proforma while line exists
      await expectSqlViolation(client, `DELETE FROM wholesale_proforma WHERE id='prof_line'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("payment CHECKs, unique reference, idempotency, FK RESTRICT", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_pay','u_pay@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_pay','u_pay','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_pay','KV-W-PAY','acc_pay','u_pay','awaiting_payment','IRR',1000,0,1000,1000,1,'{}','{}',1) ON CONFLICT DO NOTHING`);

      // Valid payment
      await client.query(`INSERT INTO payment (id, payment_reference, wholesale_order_id, method, provider, status, amount, currency, idempotency_key, request_hash, version) VALUES ('pay1','PAY-001','wo_pay','manual_transfer','manual','evidence_submitted',1000,'IRR','idem1','hash1',0)`);

      // Duplicate reference
      await expectSqlViolation(client, `INSERT INTO payment (id, payment_reference, wholesale_order_id, method, provider, status, amount, currency, version) VALUES ('pay_dup_ref','PAY-001','wo_pay','manual_transfer','manual','pending',1000,'IRR',0)`, '23505');

      // Duplicate idempotency per order
      await expectSqlViolation(client, `INSERT INTO payment (id, payment_reference, wholesale_order_id, method, provider, status, amount, currency, idempotency_key, version) VALUES ('pay_dup_idem','PAY-002','wo_pay','manual_transfer','manual','pending',1000,'IRR','idem1',0)`, '23505');

      // Invalid status
      await expectSqlViolation(client, `INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_bad_status','PAY-003','wo_pay','manual_transfer','invalid',1000,'IRR',0)`, '23514');

      // Invalid method
      await expectSqlViolation(client, `INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_bad_method','PAY-004','wo_pay','snapppay','pending',1000,'IRR',0)`, '23514');

      // Negative amount
      await expectSqlViolation(client, `INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_neg','PAY-005','wo_pay','manual_transfer','pending',-1,'IRR',0)`, '23514');

      // FK RESTRICT
      await expectSqlViolation(client, `DELETE FROM wholesale_order WHERE id='wo_pay'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("payment_allocation CHECKs, unique payment+proforma, FK RESTRICT", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_alloc','u_alloc@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_alloc','u_alloc','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_alloc','Prod','prod-alloc','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_alloc','p_alloc','SKU-alloc','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_alloc','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_alloc','SUPPLIER','sup_alloc','Seller','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit) VALUES ('off_alloc','p_alloc','seller_alloc','SKU-off-alloc','published',1000,'IRR',1,'PIECE','PIECE') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_alloc','KV-W-ALLOC','acc_alloc','u_alloc','awaiting_payment','IRR',1000,0,1000,1000,1,'{}','{}',1) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_alloc','KV-W-ALLOC-01','seller_alloc','sup_alloc','wo_alloc','pending','IRR',1000,1000,1000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order_item (id, order_id, product_id, variant_id, seller_offer_id, seller_id, supplier_id, product_name, sku, quantity, piece_quantity, unit_price, line_total, currency, product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot) VALUES ('woi_alloc','wo_alloc','p_alloc','var_alloc','off_alloc','seller_alloc','sup_alloc','Prod','SKU-alloc',1,1,1000,1000,'IRR','Prod','SKU-alloc','{}','{}') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order_item (id, purchase_order_id, wholesale_order_item_id, product_id, variant_id, seller_offer_id, product_name, sku, quantity, unit_price, total_amount) VALUES ('poi_alloc','po_alloc','woi_alloc','p_alloc','var_alloc','off_alloc','Prod','SKU-alloc',1,1000,1000) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_alloc','PROF-ALLOC-001','wo_alloc','po_alloc','seller_alloc','sup_alloc',1,'issued','IRR',1000,0,1000,'{}')`);
      await client.query(`INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_alloc','PAY-ALLOC-001','wo_alloc','manual_transfer','verified',1000,'IRR',1)`);

      // Valid allocation
      await client.query(`INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc1','pay_alloc','prof_alloc',1000,'IRR')`);

      // Duplicate payment+proforma
      await expectSqlViolation(client, `INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc_dup','pay_alloc','prof_alloc',500,'IRR')`, '23505');

      // FK RESTRICT: cannot delete payment while allocation exists
      await expectSqlViolation(client, `DELETE FROM payment WHERE id='pay_alloc'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("financial_ledger_entry append-only, amount>0, CHECKs, FK RESTRICT", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_ledger','u_ledger@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_ledger','u_ledger','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_ledger','KV-W-LEDGER','acc_ledger','u_ledger','processing','IRR',1000,0,1000,1000,1,'{}','{}',1) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_ledger','PAY-LEDGER-001','wo_ledger','manual_transfer','verified',1000,'IRR',1)`);

      // Valid ledger IN
      await client.query(`INSERT INTO financial_ledger_entry (id, order_id, payment_id, entry_type, direction, amount, currency) VALUES ('led1','wo_ledger','pay_ledger','payment_verified','IN',1000,'IRR')`);

      // Amount 0 should fail >0 check
      await expectSqlViolation(client, `INSERT INTO financial_ledger_entry (id, order_id, entry_type, direction, amount, currency) VALUES ('led_bad_zero','wo_ledger','payment_verified','IN',0,'IRR')`, '23514');

      // Invalid direction
      await expectSqlViolation(client, `INSERT INTO financial_ledger_entry (id, order_id, entry_type, direction, amount, currency) VALUES ('led_bad_dir','wo_ledger','payment_verified','INVALID',1000,'IRR')`, '23514');

      // Invalid entry_type
      await expectSqlViolation(client, `INSERT INTO financial_ledger_entry (id, order_id, entry_type, direction, amount, currency) VALUES ('led_bad_type','wo_ledger','invalid_type','IN',1000,'IRR')`, '23514');

      // UPDATE should fail due to trigger
      await expectSqlViolation(client, `UPDATE financial_ledger_entry SET amount=2000 WHERE id='led1'`, 'P0001');

      // DELETE should fail
      await expectSqlViolation(client, `DELETE FROM financial_ledger_entry WHERE id='led1'`, 'P0001');

      await client.query("ROLLBACK");
    });
  });

  it("refund CHECKs, unique reference, idempotency, FK RESTRICT, partial refund isolation", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_ref','u_ref@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_ref','u_ref','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_ref','Prod','prod-ref','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_ref','p_ref','SKU-ref','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_ref','Sup','Sup','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_ref','SUPPLIER','sup_ref','Seller','active') ON CONFLICT DO NOTHING`);
      // Use existing KOLBE seller 'seller_kolbe' from baseline seed
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_ref','KV-W-REF','acc_ref','u_ref','processing','IRR',45000000,0,45000000,45000000,3,'{}','{}',1) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_kolbe_ref','KV-W-REF-01','seller_kolbe',NULL,'wo_ref','pending','IRR',10000000,10000000,10000000,'KOLBE',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_b_ref','KV-W-REF-03','seller_ref','sup_ref','wo_ref','pending','IRR',15000000,15000000,15000000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_kolbe_ref','PROF-KOLBE-REF','wo_ref','po_kolbe_ref','seller_kolbe',NULL,1,'issued','IRR',10000000,0,10000000,'{}')`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_b_ref','PROF-B-REF','wo_ref','po_b_ref','seller_ref','sup_ref',1,'issued','IRR',15000000,0,15000000,'{}')`);
      await client.query(`INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_ref','PAY-REF-001','wo_ref','manual_transfer','verified',45000000,'IRR',1)`);
      await client.query(`INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc_kolbe_ref','pay_ref','prof_kolbe_ref',10000000,'IRR')`);
      await client.query(`INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc_b_ref','pay_ref','prof_b_ref',15000000,'IRR')`);

      // Refund B 15M should be allowed (verified allocation to B)
      await client.query(`INSERT INTO refund (id, refund_reference, wholesale_order_id, child_order_id, amount, currency, status, idempotency_key, request_hash, version) VALUES ('ref_b','REF-B-001','wo_ref','po_b_ref',15000000,'IRR','requested','idem_ref_b','hash_b',0)`);

      // Refund B again 15M should exceed refundable (already 15M allocated, 15M requested) — but DB CHECK only checks amount>=0, business logic in service checks refundable. So DB will allow, but we test DB constraints:
      // Duplicate reference should fail
      await expectSqlViolation(client, `INSERT INTO refund (id, refund_reference, wholesale_order_id, child_order_id, amount, currency, status, version) VALUES ('ref_dup','REF-B-001','wo_ref','po_b_ref',1000,'IRR','requested',0)`, '23505');

      // Duplicate idempotency per order
      await expectSqlViolation(client, `INSERT INTO refund (id, refund_reference, wholesale_order_id, child_order_id, amount, currency, status, idempotency_key, version) VALUES ('ref_dup_idem','REF-B-002','wo_ref','po_b_ref',1000,'IRR','requested','idem_ref_b',0)`, '23505');

      // Invalid status
      await expectSqlViolation(client, `INSERT INTO refund (id, refund_reference, wholesale_order_id, amount, currency, status, version) VALUES ('ref_bad_status','REF-BAD-001','wo_ref',1000,'IRR','invalid',0)`, '23514');

      // FK RESTRICT: cannot delete child while refund exists
      await expectSqlViolation(client, `DELETE FROM purchase_order WHERE id='po_b_ref'`, '23503');

      // Sibling isolation: refund B should NOT affect KOLBE allocation
      const { rows: kolbeAlloc } = await client.query(`SELECT amount FROM payment_allocation WHERE id='alloc_kolbe_ref'`);
      expect(kolbeAlloc[0].amount).toBe("10000000");

      await client.query("ROLLBACK");
    });
  });

  it("order_financial_release CHECKs and FK RESTRICT", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_rel','u_rel@test.com','h','s','admin','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_rel','u_rel','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_rel','KV-W-REL','acc_rel','u_rel','awaiting_payment','IRR',1000,0,1000,1000,1,'{}','{}',1) ON CONFLICT DO NOTHING`);

      // Valid release
      await client.query(`INSERT INTO order_financial_release (id, order_id, release_type, evidence_reference, amount, currency, actor_id, actor_role, reason) VALUES ('rel1','wo_rel','payment_verified','evid1',1000,'IRR','u_rel','admin','test')`);

      // Invalid release_type
      await expectSqlViolation(client, `INSERT INTO order_financial_release (id, order_id, release_type) VALUES ('rel_bad','wo_rel','invalid_type')`, '23514');

      // FK RESTRICT
      await expectSqlViolation(client, `DELETE FROM wholesale_order WHERE id='wo_rel'`, '23503');

      await client.query("ROLLBACK");
    });
  });

  it("business invariant: parent KOLBE 10M + A 20M + B 15M paid 45M, B fails cancelled → refund obligation 15M only, siblings continue unaffected", async () => {
    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('u_inv','u_inv@test.com','h','s','vip','active',0,0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('acc_inv','u_inv','m','s','0912','Tehran','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product (id, name, slug, status) VALUES ('p_inv','Prod','prod-inv','published') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('var_inv','p_inv','SKU-inv','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_inv_a','Sup A','Sup A','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('sup_inv_b','Sup B','Sup B','approved') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_inv_a','SUPPLIER','sup_inv_a','Seller A','active') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_inv_b','SUPPLIER','sup_inv_b','Seller B','active') ON CONFLICT DO NOTHING`);
      // Use existing KOLBE seller 'seller_kolbe' for KOLBE
      await client.query(`INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_amount, total_units, shipping_address_snapshot, billing_address_snapshot, version) VALUES ('wo_inv','KV-W-INV','acc_inv','u_inv','processing','IRR',45000000,0,45000000,45000000,3,'{}','{}',1) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_inv_kolbe','KV-W-INV-01','seller_kolbe',NULL,'wo_inv','pending','IRR',10000000,10000000,10000000,'KOLBE',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_inv_a','KV-W-INV-02','seller_inv_a','sup_inv_a','wo_inv','pending','IRR',20000000,20000000,20000000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, wholesale_order_id, status, currency, items_total, grand_total, total_amount, shipping_responsibility, version) VALUES ('po_inv_b','KV-W-INV-03','seller_inv_b','sup_inv_b','wo_inv','pending','IRR',15000000,15000000,15000000,'SUPPLIER',0) ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_inv_kolbe','PROF-INV-KOLBE','wo_inv','po_inv_kolbe','seller_kolbe',NULL,1,'issued','IRR',10000000,0,10000000,'{}')`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_inv_a','PROF-INV-A','wo_inv','po_inv_a','seller_inv_a','sup_inv_a',1,'issued','IRR',20000000,0,20000000,'{}')`);
      await client.query(`INSERT INTO wholesale_proforma (id, proforma_number, wholesale_order_id, child_order_id, seller_id, supplier_id, version, status, currency, items_total, shipping_total, total_amount, terms_snapshot) VALUES ('prof_inv_b','PROF-INV-B','wo_inv','po_inv_b','seller_inv_b','sup_inv_b',1,'issued','IRR',15000000,0,15000000,'{}')`);
      await client.query(`INSERT INTO payment (id, payment_reference, wholesale_order_id, method, status, amount, currency, version) VALUES ('pay_inv','PAY-INV-001','wo_inv','manual_transfer','verified',45000000,'IRR',1)`);
      await client.query(`INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc_inv_kolbe','pay_inv','prof_inv_kolbe',10000000,'IRR')`);
      await client.query(`INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc_inv_a','pay_inv','prof_inv_a',20000000,'IRR')`);
      await client.query(`INSERT INTO payment_allocation (id, payment_id, proforma_id, amount, currency) VALUES ('alloc_inv_b','pay_inv','prof_inv_b',15000000,'IRR')`);

      // B fails cancelled — refund obligation 15M only
      await client.query(`INSERT INTO refund (id, refund_reference, wholesale_order_id, child_order_id, amount, currency, status, version) VALUES ('ref_inv_b','REF-INV-B','wo_inv','po_inv_b',15000000,'IRR','requested',0)`);

      // Verify KOLBE and A allocations unaffected
      const { rows: kolbeRows } = await client.query(`SELECT amount FROM payment_allocation WHERE id='alloc_inv_kolbe'`);
      const { rows: aRows } = await client.query(`SELECT amount FROM payment_allocation WHERE id='alloc_inv_a'`);
      const { rows: bRows } = await client.query(`SELECT amount FROM payment_allocation WHERE id='alloc_inv_b'`);
      expect(kolbeRows[0].amount).toBe("10000000");
      expect(aRows[0].amount).toBe("20000000");
      expect(bRows[0].amount).toBe("15000000");

      // Verify refund only for B
      const { rows: refundRows } = await client.query(`SELECT amount, child_order_id FROM refund WHERE id='ref_inv_b'`);
      expect(refundRows[0].amount).toBe("15000000");
      expect(refundRows[0].child_order_id).toBe("po_inv_b");

      // Verify no refund for KOLBE/A
      const { rows: otherRefunds } = await client.query(`SELECT COUNT(*) as c FROM refund WHERE child_order_id IN ('po_inv_kolbe','po_inv_a')`);
      expect(Number(otherRefunds[0].c)).toBe(0);

      // Verify children still exist (siblings continue)
      const { rows: childCount } = await client.query(`SELECT COUNT(*) as c FROM purchase_order WHERE wholesale_order_id='wo_inv'`);
      expect(Number(childCount[0].c)).toBe(3);

      await client.query("ROLLBACK");
    });
  });
});
