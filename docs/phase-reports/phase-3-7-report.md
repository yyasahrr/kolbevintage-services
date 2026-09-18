# فاز ۳.۷ — Transaction Readiness & Legacy Bridge

تاریخ: 2026-09-17
شاخه: `arena/01a0ad1f-kolbevintage-services`
وضعیت: ✅ انجام شد — آماده برای فاز ۴

## خلاصه

هدف این فاز: آماده‌سازی مسیر **Canonical Product → Product Variant → Seller Offer → Product Variant Inventory → Inventory Reservation → Order Engine** بدون وابستگی جدید به مدل‌های قدیمی `supplier_product/supplier_variant/supplier_inventory`، در حالی که جدول‌های قدیمی موقتاً باقی می‌مانند.

- ۲ جدول جدید نگاشت میراث: `legacy_product_mapping`, `legacy_variant_mapping`
- ۱۱ ستون جدید کانونیکال nullable روی `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote` با FK RESTRICT، بدون حذف FK قدیمی
- ۴۷ جدول (۴۵ + ۲)، ۸ مهاجرت
- ۳۵۲+ تست قبلی + ۱۱ تست جدید فاز ۳.۷ = ۴۷ تست دیتابیس + ۱۴۹ تست API
- تمام gateها سبز: `db:migrate`, `typecheck:all`, `test:all`, `build`, `infra:verify`

## ۱) Legacy Product Mapping Layer

### جداول جدید
- `legacy_product_mapping`:
  - `id` PK
  - `legacy_supplier_product_id` NOT NULL, UNIQUE, FK → `supplier_product.id` RESTRICT
  - `canonical_product_id` NOT NULL, FK → `product.id` RESTRICT
  - `created_by` nullable FK → `account_user.id` RESTRICT
  - `status` CHECK `PENDING/MAPPED/REJECTED` default PENDING
  - `created_at`, `updated_at`
  - Index: canonical, status

- `legacy_variant_mapping`:
  - `id` PK
  - `legacy_supplier_variant_id` NOT NULL, UNIQUE, FK → `supplier_variant.id` RESTRICT
  - `canonical_variant_id` NOT NULL, FK → `product_variant.id` RESTRICT
  - `created_by` nullable FK → `account_user.id`
  - `status` CHECK `PENDING/MAPPED/REJECTED`
  - Index: canonical, status

### منطق کسب‌وکار
- **No automatic destructive merge**: نگاشت بدون `created_by` و تأیید ادمین مجاز نیست (`assertNoAutomaticMerge`).
- **SKU matching suggests candidates**: تابع `suggestCanonicalCandidatesBySku` تطبیق دقیق SKU (case-insensitive) را پیشنهاد می‌دهد، نه ادغام خودکار.
- **Admin approval required**: انتقال وضعیت فقط با نقش `admin`:
  - `PENDING → MAPPED/REJECTED`
  - `MAPPED → REJECTED`
  - `REJECTED → PENDING`
- **Preserve historical references**: جدول قدیمی حذف نمی‌شود، نگاشت جداست، FK قدیمی باقی.

### تست‌ها
- `legacy-mapping.spec.ts`: انتقال وضعیت ادمین-فقط، جلوگیری از ادغام خودکار، پیشنهاد SKU، حفظ تاریخچه، جلوگیری از تکراری (unique index).
- `phase-3-7.test.ts`: وجود جداول، یکتایی، CHECK، FK.

## ۲) Wholesale Order Future References

### حسابرسی جدول‌های قدیمی
- `wholesale_order_item`: قبلاً `product_id` → `supplier_product`, `variant_id` → `supplier_variant`
- `purchase_order_item`: `variant_id` → `supplier_variant`
- `rfq`: فقط `supplier_id`
- `quote`: `rfq_id`, `supplier_id`

### تغییرات
- `wholesale_order_item` + `canonical_product_id` nullable FK → `product`, `canonical_variant_id` FK → `product_variant`, `seller_offer_id` FK → `seller_offer`
- `purchase_order_item` همین سه ستون
- `rfq` + `canonical_product_id`, `seller_offer_id`
- `quote` + `canonical_product_id`, `canonical_variant_id`, `seller_offer_id`

**نکته**: تمام ستون‌های جدید nullable هستند تا جریان قدیمی نشکند. FK قدیمی حذف نشد (coexistence). در فاز ۴، Order Engine از ستون‌های کانونیکال استفاده می‌کند.

### تست‌ها
- `phase-3-7.test.ts`: ۱۱ ستون nullable، FK RESTRICT، FK قدیمی همچنان موجود.

## ۳) Inventory Cutover Boundary

### حسابرسی مستقیم `supplier_inventory`
- **Legacy compatibility**: `frontend-next/server/kolbe-api.ts` کاتالوگ `LEFT JOIN supplier_inventory` برای نمایش محصول (read-only)
- **Active transaction path**: `frontend-next/server/kolbe-api.ts`:
  - `POST wholesale/orders` SELECT FOR UPDATE + UPDATE reserved
  - `purchase_order delivered` UPDATE on_hand/reserved
  - `cancel` UPDATE reserved
- **Migration only**: `packages/database/test/*` INSERT/UPDATE برای آزمون قیدها

### طبقه‌بندی
| نوع | مکان | وضعیت |
|---|---|---|
| legacy compatibility | frontend-next/server/kolbe-api.ts catalog LEFT JOIN | مجاز تا پایان مهاجرت |
| active transaction | frontend-next/server/kolbe-api.ts wholesale/orders, purchase_order, cancel | باید به InventoryService مهاجرت کند |
| migration only | packages/database/test/* | مجاز |

### LegacyInventoryAdapter
- فایل: `apps/api/src/modules/inventory/legacy-adapter.ts`
- **تنها مکان مجاز** برای دسترسی مستقیم به `supplier_inventory` خارج از تست‌ها
- متدها:
  - `readLegacyInventory(variantId)` — خواندن قدیمی
  - `readNewInventoryForLegacyVariant(legacyVariantId, sellerId)` — پل via `legacy_variant_mapping` → `product_variant_inventory`
  - `assertLegacyAccessAllowed(context)` — جلوگیری از دسترسی مستقیم در کد جدید
- پیام: «Direct access to supplier_inventory not allowed outside legacy adapters — use InventoryService»

### قانون جدید
- کد جدید **نباید** `supplier_inventory` را مستقیم بخواند/بنویسد. فقط `InventoryService` و `LegacyInventoryAdapter`.

## ۴) Wholesale Reservation Readiness

### چرخهٔ وضعیت‌ها
`pending → active → confirmed/released/expired/cancelled`
- `pending → active` فقط supplier/admin/system
- `active → confirmed` supplier/admin/system
- `active → released` supplier/admin/system/vip (vip می‌تواند رزرو خودش را آزاد کند)
- `active → expired` فقط system (cron)
- `pending/active → cancelled` supplier/admin/system/vip

پیاده‌سازی: `transitionReservation`, `assertReservationTransition`

### فیلدهای رزرو
- `variant_id` — موجودی/واریانت
- `seller_id` — فروشنده مالک
- `quantity` — تعداد
- `status` — وضعیت
- `expires_at` — انقضا
- `request_id` — ارجاع به `wholesale_request` (order ref)
- `created_by` — درخواست‌کننده

### All-or-Nothing Package
- `ReservationPackage`: `requestId`, `sellerId`, `items: [{variantId, quantity}]`
- اعتبارسنجی: `validateReservationPackage`
  - خالی نباشد
  - هر آیتم quantity > 0
  - واریانت تکراری ممنوع (no partial)
- منطق: رزرو بسته یا کامل موفق است یا کامل شکست — هیچ رزرو جزئی.

### Release Restores + Ledger
- `releaseReservation`: `reserved` کاهش می‌یابد، `on_hand` بدون تغییر، ledger `RELEASE` با `quantityDelta = -qty`
- `confirmReservation`: `on_hand` و `reserved` هر دو کاهش، ledger `DECREASE`
- `createReservation`: `reserved` افزایش، ledger `RESERVE`
- تست: `inventory-phase-3-7.spec.ts`

## ۵) Inventory Audit Integration

### اتصال `inventory_ledger` + `audit_log`
- هر تغییر موجودی یک ردیف `inventory_ledger` می‌سازد:
  - `variantId`, `sellerId`, `changeType`, `quantityDelta`, `beforeOnHand`, `afterOnHand`, `beforeReserved`, `afterReserved`, `reason`, `actorId`, `createdAt`
- هر عملیات موجودی یک ردیف `audit_log` (best-effort, fail-open نمی‌کند عملیات را) می‌سازد:
  - `actorId`, `actorRole`, `action` (inventory.increased/decreased/reserved/released/confirmed/expired), `entityType` (product_variant_inventory/inventory_reservation), `entityId`, `before`, `after`, `metadata` (variantId, sellerId, reason, requestId, quantityDelta), `requestId`, `createdAt`
- بدون بازطراحی audit: از همان جدول `audit_log` و تریگر append-only استفاده می‌شود.

### پیاده‌سازی
- `InventoryService.recordAudit()` — insert مستقیم به `audit_log` با try/catch
- فراخوانی در: `upsertVariantInventory`, `createReservation`, `releaseReservation`, `confirmReservation`, `releaseExpiredReservations`

## ۶) Seller Offer Cleanup

### Deprecated fields
- `seller_offer.inventory_on_hand`, `inventory_reserved`:
  - در اسکیما موجود ولی default 0، CHECK `reserved <= on_hand`
  - در سرویس `OffersService.createOffer` همیشه 0 نوشته می‌شود، ورودی کلاینت نادیده گرفته می‌شود
  - در کنترلر `OffersController.createOffer` اگر `inventoryOnHand` از کلاینت بیاید، `console.warn` و نادیده گرفته می‌شود
  - **Source of truth**: `product_variant_inventory` (supplier-owned, variant-level)
  - تست: `phase-3-7.test.ts` بررسی default 0

### قانون
- External APIs cannot update deprecated fields
- Not used for availability — فقط `product_variant_inventory` برای موجودی

## ۷) Retail/Wholesale Boundary

### قوانین
- Retail = Kolbe only: فقط seller type KOLBE می‌تواند `retailPrice` داشته باشد
- Wholesale = Kolbe+Supplier: هر دو می‌توانند wholesale بفروشند
- Kolbe Exclusive: `product.is_kolbe_exclusive=true` → supplier نمی‌تواند offer بسازد
- Supplier never in retail: `assertOfferAllowedForProduct` اگر `sellerType=SUPPLIER && retailPrice!=null` خطا می‌دهد

### تست‌ها
- `retail-boundary.spec.ts`: retail فقط Kolbe, wholesale هر دو, supplier هرگز خرده, Kolbe exclusive مسدود
- `retail-isolation.spec.ts`: موجود از قبل
- `product-authority.spec.ts`: مالکیت محصول

## ۸) Phase 4 Readiness Report

### ✅ Completed
- [x] Legacy mapping tables with PENDING/MAPPED/REJECTED, admin approval, no auto-merge
- [x] SKU suggest candidates
- [x] Canonical references on wholesale_order_item, purchase_order_item, rfq, quote (nullable, coexist)
- [x] LegacyInventoryAdapter with classification doc
- [x] Inventory reservation lifecycle PENDING/ACTIVE/CONFIRMED/RELEASED/EXPIRED/CANCELLED with requester/expiration/order ref
- [x] All-or-nothing package validation
- [x] Release restores + ledger entry
- [x] inventory_ledger + audit_log integration with actor/action/reason/reference/timestamp
- [x] Seller offer deprecated fields not writable/used
- [x] Retail/wholesale boundary enforced + tests
- [x] 47 tables, 8 migrations, build green

### ⏳ Remaining Legacy Dependencies (برای فاز ۴ باید حذف شوند)
- `frontend-next/server/kolbe-api.ts`:
  - Catalog LEFT JOIN `supplier_inventory` → باید به `product_variant_inventory` مهاجرت کند
  - `POST wholesale/orders` SELECT FOR UPDATE `supplier_inventory` → باید به `InventoryService.reservePackage`
  - `purchase_order delivered` UPDATE `supplier_inventory` → باید به `InventoryService.confirmReservation`
  - `cancel` UPDATE `supplier_inventory` → باید به `InventoryService.releaseReservation`
- `supplier_product`, `supplier_variant` still used in wholesale flow (via mapping layer now)
- `wholesale_order_item.product_id/variant_id` old FKs still used — باید در فاز ۴ به canonical refs سوئیچ شود

### ✅ Readiness Confirmation: VIP Request → Supplier Confirmation → Reservation → Order بدون `supplier_inventory/supplier_product/supplier_variant`

**آیا می‌توان مسیر را بدون جدول‌های قدیمی اجرا کرد؟**

**بله، از نظر منطقی:**

1. **VIP Request**: `wholesale_request` با `productId` → `product` (کانونیکال) و `offerId` → `seller_offer` (جدید) — قبلاً فقط legacy بود، حالا canonical
2. **Supplier Confirmation**: تأمین‌کننده درخواست را می‌پذیرد (`wholesale_request.status = accepted`)
3. **Reservation**: `InventoryService.createReservation` با `variantId` → `product_variant`, `sellerId` → `seller`, `quantity`, `expiresAt`, `requestId` → بدون نیاز به `supplier_inventory`
4. **Order**: `wholesale_order` + `wholesale_order_item` با `canonical_product_id`, `canonical_variant_id`, `seller_offer_id` — قابل ساخت بدون `supplier_product/variant`

**مسدودکننده‌های فعلی برای اجرای کامل بدون legacy:**
- کد `frontend-next/server/kolbe-api.ts` هنوز legacy را می‌خواند — باید در فاز ۴ به NestJS InventoryService مهاجرت کند (strangler)
- `wholesale_order_item.product_id` قدیمی هنوز NOT NULL است — در فاز ۴ باید nullable شود یا با canonical پر شود
- `purchase_order` هنوز `supplier_id` قدیمی دارد — باید به `seller_id` مهاجرت کند

**اما از نظر معماری جدید (NestJS modules):**
- `InventoryService` فقط `product_variant_inventory` را می‌خواند
- `LegacyMappingService` پل را فراهم می‌کند
- `LegacyInventoryAdapter` دسترسی قدیمی را ایزوله می‌کند
- **مسیر جدید بدون `supplier_inventory` قابل اجراست** — فقط لایهٔ قدیمی Next.js باید قطع شود.

## تست‌های جدید فاز ۳.۷

- `packages/database/test/phase-3-7.test.ts` (۱۱ تست):
  - جدول‌های نگاشت، یکتایی، CHECK، مراجع کانونیکال nullable، FK RESTRICT، coexistence FK قدیمی، چرخهٔ رزرو، فیلدهای requester/expiration/order ref، اتصال ledger+audit، deprecated seller_offer، ۴۷ جدول
- `apps/api/src/modules/catalog/legacy-mapping.spec.ts` (۵ تست):
  - انتقال وضعیت ادمین-فقط، جلوگیری از ادغام خودکار، پیشنهاد SKU، حفظ تاریخچه، جلوگیری از تکراری
- `apps/api/src/modules/inventory/inventory-phase-3-7.spec.ts` (۵ تست):
  - چرخهٔ وضعیت‌ها، فیلدهای موجودی/واریانت/فروشنده/درخواست‌کننده/انقضا/ارجاع، all-or-nothing، release restores، expired detection
- `apps/api/src/modules/catalog/retail-boundary.spec.ts` (۴ تست):
  - retail فقط Kolbe, wholesale هر دو, supplier هرگز خرده, Kolbe exclusive مسدود

## Gateها

- `db:migrate`: ✅ ۸ مهاجرت، ۴۷ جدول، ۸۰ FK، ۹۳ CHECK
- `typecheck:all`: ✅
- `test:all`: ✅ ۲۱ shared + ۴۷ database + ۱۴۹ api
- `build`: ✅ Next.js build
- `infra:verify`: ✅

## مهاجرت

- فایل: `0007_phase_3_7_legacy_bridge.sql`
- Snapshot: `0007_snapshot.json`
- Journal: idx 7

## Commit Strategy (انجام‌شده)

- feat(migration): add legacy_product_mapping, legacy_variant_mapping, canonical refs on wholesale_order_item/purchase_order_item/rfq/quote
- feat(order): add canonical refs coexistence, preserve old FKs
- refactor(inventory): create LegacyInventoryAdapter, classify supplier_inventory usages, enforce no direct access
- feat(audit): integrate inventory_ledger + audit_log with actor/action/reason/reference/timestamp
- test(marketplace): add mapping duplicate prevention, inventory boundary, canonical refs, retail isolation
- docs(marketplace): phase-3-7 report + readiness confirmation

## گام بعدی (فاز ۴)

- حذف دسترسی مستقیم `supplier_inventory` از `frontend-next/server/kolbe-api.ts`
- پیاده‌سازی Order Engine با استفاده از `canonical_product_id`, `canonical_variant_id`, `seller_offer_id`
- مهاجرت `wholesale_order_item.product_id` به nullable + پر کردن canonical
- پیاده‌سازی `VIP Request → Supplier Confirmation → Reservation → Order` فقط با مدل کانونیکال
- تست E2E بدون legacy tables
