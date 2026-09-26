/**
 * تستِ قراردادهای گرافِ محصولِ تأمین‌کننده (capability parity — 6.2-hardening).
 *
 * این قراردادها تایپ‌محورند؛ اینجا فقط helper های خالص (نگهبانِ واحدها و
 * پیش‌نمایشِ جمعِ بسته) بررسی می‌شوند. جمعِ بسته فقط پیش‌نمایش است و مرجعِ
 * نهایی سرور است؛ هیچ محاسبهٔ پولی در کلاینت انجام نمی‌شود.
 */

import { describe, expect, it } from "vitest";
import {
  MOQ_UNITS,
  PACKAGE_TYPES,
  isMoqUnit,
  isPackageType,
  packageTotalUnits,
} from "../shared/supplier/contracts";

describe("Phase 6.2 supplier product contract", () => {
  it("recognises every backend MOQ unit including SERIES", () => {
    for (const unit of MOQ_UNITS) expect(isMoqUnit(unit)).toBe(true);
    expect(MOQ_UNITS).toContain("SERIES");
    expect(isMoqUnit("KILOGRAM")).toBe(false);
    expect(isMoqUnit(undefined)).toBe(false);
  });

  it("recognises every backend package type", () => {
    for (const type of PACKAGE_TYPES) expect(isPackageType(type)).toBe(true);
    expect(PACKAGE_TYPES).toEqual(["SIZE_RUN", "FIXED_QUANTITY", "COLOR_MIX", "CUSTOM_BUNDLE"]);
    expect(isPackageType("RANDOM")).toBe(false);
  });

  it("previews a SIZE_RUN package total without touching money", () => {
    // Series A: S×2, M×2, L×2, XL×1 = 7 pieces
    const items = [
      { variantId: "v_s", quantity: 2 },
      { variantId: "v_m", quantity: 2 },
      { variantId: "v_l", quantity: 2 },
      { variantId: "v_xl", quantity: 1 },
    ];
    expect(packageTotalUnits(items)).toBe(7);
  });

  it("ignores invalid quantities in the preview (defensive, non-authoritative)", () => {
    expect(packageTotalUnits([{ quantity: 3 }, { quantity: -5 }, { quantity: NaN }, { quantity: 2.9 }])).toBe(5);
    expect(packageTotalUnits([])).toBe(0);
  });
});
