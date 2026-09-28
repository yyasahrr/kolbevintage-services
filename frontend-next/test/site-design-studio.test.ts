import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, login } from "./helpers";
import { rows } from "../server/database";

/**
 * استودیوی طراحی سایت (پاسخ ۵۰) — بک‌اند اختصاصی.
 *
 * این تست قرارداد کامل را می‌سنجد: پیش‌نویس ≠ زنده، انتشار، بازگردانی نسخه،
 * آینهٔ سازگاری `site_setting` و رد بار نامعتبر. داده‌های پیشین جدول‌ها در
 * پایان بازگردانده می‌شوند تا سایر تست‌ها (که فروشگاه را رندر می‌کنند) تحت
 * تأثیر انتشار این تست نباشند.
 */
describe("استودیوی طراحی سایت", () => {
  let token = "";
  let previousSetting: { value: unknown; updated_by: string | null } | null = null;

  beforeAll(async () => {
    token = (await login("admin")).token;
    const [row] = await rows<any>("SELECT value, updated_by FROM site_setting WHERE setting_key='storefront' LIMIT 1");
    previousSetting = row ? { value: row.value, updated_by: row.updated_by ?? null } : null;
  });

  afterAll(async () => {
    await rows("DELETE FROM site_design_revision WHERE setting_key='storefront'");
    if (previousSetting) {
      await rows(
        `INSERT INTO site_setting (setting_key, value, updated_by, updated_at) VALUES ('storefront',$1,$2, now())
         ON CONFLICT (setting_key) DO UPDATE SET value=$1, updated_by=$2, updated_at=now()`,
        [JSON.stringify(previousSetting.value), previousSetting.updated_by],
      );
    } else {
      await rows("DELETE FROM site_setting WHERE setting_key='storefront'");
    }
  });

  it("بدون نشست مدیر پاسخ ۴۰۱ می‌دهد", async () => {
    const result = await call("admin/site-design");
    expect(result.status).toBe(401);
  });

  it("پیش‌نویس ذخیره می‌شود و سایت زنده تغییر نمی‌کند", async () => {
    const draftPayload = { header: { brand: "کلبه" }, footer: { copyright: "۱۲۴۵" } };
    const saved = await call("admin/site-design/draft", { method: "PUT", token, body: { settings: draftPayload, note: "آزمون پیش‌نویس" } });
    expect(saved.status).toBe(200);
    expect(saved.body.draft.payload).toMatchObject(draftPayload);
    expect(saved.body.draft.note).toBe("آزمون پیش‌نویس");

    const live = await call("site/design");
    expect(live.status).toBe(200);
    expect(live.body.settings?.header?.brand ?? null).not.toBe("کلبه");
  });

  it("انتشار، نسخهٔ زنده را می‌سازد و در site_setting آینه می‌شود", async () => {
    const draftPayload = { header: { brand: "کلبهٔ آزمون" }, footer: { copyright: "۱۲۴۵" } };
    await call("admin/site-design/draft", { method: "PUT", token, body: { settings: draftPayload, note: "نسخهٔ آزمون" } });
    const published = await call("admin/site-design/publish", { method: "POST", token, body: {} });
    expect(published.status).toBe(200);
    expect(published.body.published.payload.header.brand).toBe("کلبهٔ آزمون");
    expect(published.body.published.publishedAt).toBeTruthy();

    const live = await call("site/design");
    expect(live.body.settings.header.brand).toBe("کلبهٔ آزمون");

    const [mirror] = await rows<any>("SELECT value FROM site_setting WHERE setting_key='storefront' LIMIT 1");
    expect((mirror?.value as any).header.brand).toBe("کلبهٔ آزمون");
  });

  it("تاریخچه، نسخهٔ پیشین را نگه می‌دارد و بازگردانی پیش‌نویس تازه می‌سازد", async () => {
    const before = await call("admin/site-design", { token });
    const publishedRevision = before.body.revisions.find((item: any) => item.status === "published");
    expect(publishedRevision).toBeTruthy();

    const restored = await call("admin/site-design/restore", { method: "POST", token, body: { revisionId: publishedRevision.id } });
    expect(restored.status).toBe(200);
    expect(restored.body.draft.payload.header.brand).toBe("کلبهٔ آزمون");
    expect(restored.body.draft.note).toContain("بازگردانی");

    const state = await call("admin/site-design", { token });
    expect(state.body.revisions.length).toBeGreaterThanOrEqual(2);
  });

  it("بار نامعتبر رد می‌شود (بخش ناشناس، بار خالی) و ویدیوی جاسازی‌شده پاک می‌شود", async () => {
    const unknown = await call("admin/site-design/draft", { method: "PUT", token, body: { settings: { somethingElse: 1 } } });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toBe("INVALID_SITE_DESIGN_KEYS");

    const empty = await call("admin/site-design/draft", { method: "PUT", token, body: { settings: {} } });
    expect(empty.status).toBe(422);
    expect(empty.body.error).toBe("EMPTY_SITE_DESIGN");

    const embedded = await call("admin/site-design/draft", {
      method: "PUT",
      token,
      body: { settings: { heroStudio: { heroVideo: "data:video/mp4;base64,AAAA" } } },
    });
    expect(embedded.status).toBe(200);
    expect(embedded.body.draft.payload.heroStudio.heroVideo).toBe("/store/kolbe/site/hero-video");
  });

  it("انتشار بدون پیش‌نویس ۴۰۴ می‌دهد", async () => {
    const state = await call("admin/site-design", { token });
    if (state.body.draft) {
      // با انتشار پیش‌نویس موجود، پیش‌نویس فعال پاک می‌شود و شرط تست آماده است.
      const published = await call("admin/site-design/publish", { method: "POST", token, body: {} });
      expect(published.status).toBe(200);
    }
    const result = await call("admin/site-design/publish", { method: "POST", token, body: {} });
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("SITE_DESIGN_DRAFT_NOT_FOUND");
  });
});
