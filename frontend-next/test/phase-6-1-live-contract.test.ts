/**
 * تستِ زندهٔ مرز مشترک در برابر API واقعیِ Nest (فاز ۶.۱).
 *
 * این فایل وقتی اجرا می‌شود که harness تست سرویس Nest را بالا آورده باشد
 * (`test/global-setup.ts` متغیر `KOLBE_API_INTERNAL_URL` را ست می‌کند). در
 * پیکربندیِ متمرکزِ `vitest.phase-6-1.config.ts` (بدون دیتابیس) رد می‌شود تا
 * مجموعه روی هر ماشینی سبز بماند.
 *
 * هدف: اثبات اینکه خطاهای نگاشت‌شده فقط حدسِ واحد تست نیستند و همان رفتار روی
 * قراردادِ واقعیِ سرور هم برقرار است.
 */

import { describe, expect, it } from "vitest";
import { createApiClient } from "../shared/http";
import { createSessionClient } from "../shared/session";
import { stateFromResult } from "../shared/ui/async-state";

const internalUrl = process.env.KOLBE_API_INTERNAL_URL;

describe.skipIf(!internalUrl)("Phase 6.1 shared boundary against the live Nest API", () => {
  function liveClient() {
    return createApiClient({ baseUrl: () => internalUrl ?? "" });
  }

  it("answers a public health request successfully", async () => {
    const result = await liveClient().requestResult<{ status?: string }>("/health/live");
    expect(result.ok).toBe(true);
  });

  it("maps a missing session to UNAUTHORIZED using the real auth contract", async () => {
    const result = await liveClient().requestResult<unknown>("/auth/me");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("UNAUTHORIZED");
      expect(result.error.status).toBe(401);
    }
    const state = stateFromResult(result);
    expect(state.status).toBe("UNAUTHORIZED");
  });

  it("restores an anonymous session from the server without inventing identity", async () => {
    const session = await createSessionClient(liveClient()).restore();
    expect(session.status).toBe("anonymous");
    expect(session.user).toBeNull();
    expect(session.source).toBe("server");
  });

  it("maps an invalid login payload to a validation error", async () => {
    const result = await liveClient().requestResult<unknown>("/auth/login", {
      method: "POST",
      body: { email: "not-an-email", password: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["VALIDATION_ERROR", "UNAUTHORIZED", "RATE_LIMITED"]).toContain(result.error.kind);
    }
  });

  it("reports a missing canonical route as NOT_FOUND, never as empty data", async () => {
    const result = await liveClient().requestResult<unknown>("/this-route-does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"]).toContain(result.error.kind);
      expect(result).not.toHaveProperty("data");
    }
  });
});
