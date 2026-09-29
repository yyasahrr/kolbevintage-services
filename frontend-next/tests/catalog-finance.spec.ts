import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, call, dbQuery, login, unique } from "./helpers";

const created: string[] = [];
let admin = "";

beforeAll(async () => {
  admin = await login(ADMIN.email, ADMIN.password);
});

afterAll(async () => {
  await dbQuery("DELETE FROM personal_coupon WHERE code LIKE 'K%'");
  await dbQuery("DELETE FROM promotion_rule WHERE name LIKE 'تست %'");
  await dbQuery("DELETE FROM product_attribute_value WHERE product_id LIKE 'pim-%'");
  await dbQuery("DELETE FROM product_spec_binding WHERE product_id LIKE 'pim-%'");
  await dbQuery("DELETE FROM product_size_guide WHERE product_id LIKE 'pim-%'");
  await dbQuery("DELETE FROM product_extra_attribute WHERE product_id LIKE 'pim-%'");
  await dbQuery("DELETE FROM journal_line WHERE entry_id IN (SELECT id FROM journal_entry WHERE source_id LIKE 'fin-%' OR memo LIKE 'تست %')");
  await dbQuery("DELETE FROM journal_entry WHERE source_id LIKE 'fin-%' OR memo LIKE 'تست %'");
  await dbQuery("DELETE FROM accounting_period WHERE name LIKE 'تست %'");
  await dbQuery("DELETE FROM shipping_allocation_line WHERE allocation_id IN (SELECT id FROM shipping_allocation WHERE reference LIKE 'fin-%')");
  await dbQuery("DELETE FROM shipping_allocation WHERE reference LIKE 'fin-%'");
  for (const id of created) await dbQuery("DELETE FROM account_user WHERE id=$1", [id]);
});

describe("dynamic catalog and finance", () => {
  it("stores attributes without a schema change and rejects unknown options", async () => {
    const code = unique("fabric").replace(/[^a-z0-9_]/g, "").slice(0, 20);
    const attribute = await call("POST", "admin/attributes", { token: admin, body: { code, label: "جنس", type: "single_select", options: [{ code: "linen", label: "کتان" }] } });
    expect(attribute.status).toBe(201);
    const template = await call("POST", "admin/spec-templates", { token: admin, body: { code: unique("tmpl").replace(/[^a-z0-9_]/g, "").slice(0, 20), name: "قالب تست" } });
    expect(template.status).toBe(201);
    await call("POST", `admin/spec-templates/${template.data.template.id}/attributes`, { token: admin, body: { attributeId: attribute.data.attribute.id, required: true } });
    const productId = unique("pim");
    const bad = await call("POST", `admin/products/${productId}/specifications`, { token: admin, body: { templateId: template.data.template.id, values: { [code]: "silk" } } });
    expect(bad.status).toBe(422);
    const saved = await call("POST", `admin/products/${productId}/specifications`, { token: admin, body: { templateId: template.data.template.id, values: { [code]: "linen" }, extras: [{ label: "یقه", type: "text", value: "آرشال" }] } });
    expect(saved.status).toBe(200);
    const templateAfter = await call("GET", `admin/spec-templates/${template.data.template.id}`, { token: admin });
    expect(templateAfter.data.ungrouped.some((item: { code: string }) => item.code === code)).toBe(true);
    expect(JSON.stringify(templateAfter.data)).not.toContain("یقه");
  });

  it("keeps a detached size guide when the template publishes a new version", async () => {
    const code = unique("guide").replace(/[^a-z0-9_]/g, "").slice(0, 20);
    const first = await call("POST", "admin/size-guides", { token: admin, body: { code, name: "نسخه اول", columns: [{ code: "size", label: "سایز" }], rows: [{ size: "M" }] } });
    expect(first.status).toBe(201);
    await call("POST", `admin/size-guides/${first.data.guide.id}/publish`, { token: admin, body: {} });
    const productId = unique("pim");
    await call("POST", `admin/products/${productId}/size-guide`, { token: admin, body: { code, mode: "detached" } });
    const second = await call("POST", "admin/size-guides", { token: admin, body: { code, name: "نسخه دوم", columns: [{ code: "size", label: "سایز" }, { code: "chest", label: "سینه" }], rows: [{ size: "L", chest: "100" }] } });
    await call("POST", `admin/size-guides/${second.data.guide.id}/publish`, { token: admin, body: {} });
    const detached = await call("GET", `products/${productId}/size-guide`);
    expect(detached.data.guide.version).toBe(1);
    expect(detached.data.guide.columns).toHaveLength(1);
  });

  it("dry-runs a birthday rule without issuing a coupon and blocks marketing without consent", async () => {
    const phone = `0912${Date.now().toString().slice(-7)}`;
    const userId = unique("user");
    created.push(userId);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
    await dbQuery(
      "INSERT INTO account_user (id, email, phone, password_hash, salt, role, birth_date, marketing_sms) VALUES ($1,$2,$3,'x','y','customer',$4,false)",
      [userId, `${userId}@kolbe.test`, phone, today],
    );
    const rule = await call("POST", "admin/promotions", { token: admin, body: { name: "تست تولد", trigger: "birthday", action: { percent: 10, maxDiscount: 1000, sms: "تولد" }, audienceCap: 5 } });
    const dry = await call("POST", `admin/promotions/${rule.data.rule.id}/run`, { token: admin, body: { dryRun: true } });
    expect(dry.data.matched).toBeGreaterThan(0);
    expect(dry.data.issued).toBe(0);
    const coupons = await dbQuery("SELECT id FROM personal_coupon WHERE rule_id=$1", [rule.data.rule.id]);
    expect(coupons).toHaveLength(0);
    const active = await call("POST", `admin/promotions/${rule.data.rule.id}`, { token: admin, body: { name: "تست تولد", trigger: "birthday", status: "active", action: { percent: 10, maxDiscount: 1000, sms: "تولد" } } });
    expect(active.status).toBe(200);
    const live = await call("POST", `admin/promotions/${rule.data.rule.id}/run`, { token: admin, body: { dryRun: false } });
    expect(live.status).toBe(200);
    const notes = await dbQuery("SELECT body FROM crm_note WHERE subject_id=$1 AND kind='sms_blocked'", [userId]);
    expect(notes.length).toBeGreaterThan(0);
    const queued = await dbQuery("SELECT id FROM customer_notification WHERE user_id=$1 AND channel='sms'", [userId]);
    expect(queued).toHaveLength(0);
  });

  it("rejects an unbalanced journal, a closed period, and a missing allocation weight", async () => {
    const unbalanced = await call("POST", "admin/finance/journal", { token: admin, body: { memo: "تست نامتوازن", sourceId: unique("fin"), lines: [{ account: "cash", debit: 1000 }, { account: "sales", credit: 900 }] } });
    expect(unbalanced.status).toBe(422);
    const period = await call("POST", "admin/finance/periods", { token: admin, body: { name: "تست دوره", startsOn: "2020-01-01", endsOn: "2020-01-31", status: "open" } });
    await call("POST", `admin/finance/periods/${period.data.period.id}/locked`, { token: admin, body: {} });
    const locked = await call("POST", "admin/finance/journal", { token: admin, body: { memo: "تست قفل", sourceId: unique("fin"), occurredAt: "2020-01-15T00:00:00.000Z", lines: [{ account: "cash", debit: 1000 }, { account: "sales", credit: 1000 }] } });
    expect(locked.status).toBe(422);
    const missing = await call("POST", "admin/finance/allocations", { token: admin, body: { reference: unique("fin"), method: "weight", totalFee: 30000, lines: [{ supplierId: "s1" }, { supplierId: "s2", weight: 2 }] } });
    expect(missing.status).toBe(422);
    const split = await call("POST", "admin/finance/allocations", { token: admin, body: { reference: unique("fin"), method: "weight", totalFee: 30000, weightGrams: 300, lines: [{ supplierId: "s1", weight: 1 }, { supplierId: "s2", weight: 2 }] } });
    expect(split.status).toBe(201);
    expect(split.data.lines.reduce((sum: number, line: { amount: number }) => sum + line.amount, 0)).toBe(30000);
  });

  it("appends an adjustment instead of editing the original journal line", async () => {
    const sourceId = unique("fin");
    const posted = await call("POST", "admin/finance/journal", { token: admin, body: { memo: "تست فروش", sourceId, lines: [{ account: "receivable", debit: 5000, partyType: "supplier", partyId: "sup-test" }, { account: "supplier_payable", credit: 5000, partyType: "supplier", partyId: "sup-test" }] } });
    expect(posted.status).toBe(201);
    const adjustment = await call("POST", "admin/finance/adjustments", { token: admin, body: { partyId: "sup-test", amount: 700, reason: "تست تعدیل", reference: sourceId } });
    expect(adjustment.status).toBe(201);
    const original = await dbQuery("SELECT credit FROM journal_line WHERE entry_id=$1 AND account_code='supplier_payable'", [posted.data.id]);
    expect(Number(original[0].credit)).toBe(5000);
    const added = await dbQuery("SELECT id FROM finance_adjustment WHERE id=$1", [adjustment.data.id]);
    expect(added).toHaveLength(1);
  });

  it("builds the sales chart from orders, not a fixed series", async () => {
    const series = await call("GET", "admin/finance/series?range=today", { token: admin });
    expect(series.status).toBe(200);
    const orders = await dbQuery("SELECT COALESCE(SUM(total_amount),0)::bigint AS sales FROM retail_order WHERE created_at >= date_trunc('day', now())");
    const chartSales = (series.data.points ?? []).reduce((sum: number, point: { sales: number }) => sum + Number(point.sales), 0);
    expect(chartSales).toBe(Number(orders[0].sales));
  });
});
