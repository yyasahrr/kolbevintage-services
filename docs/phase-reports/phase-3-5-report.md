# فاز ۳.۵ — تثبیت بازار و مالکیت موجودی — گزارش

**شاخه:** `arena/01a0ad1f-kolbevintage-services`  
**SHA شروع:** `6bc805d` (پایان فاز ۳)  
**SHA پایان:** (پس از کامیت‌های فاز ۳.۵)  
**تاریخ:** 2026-09-17 Asia/Tehran

## خلاصهٔ اجرایی

فاز ۳.۵ پیش از جریان تراکنش، ابهام موجودی و دوگانگی محصول را رفع می‌کند:

- **منبع حقیقت موجودی:** تأمین‌کننده (Supplier Inventory System) — کلبه مالک موجودی تأمین‌کننده نمی‌شود
- **موجودی در سطح واریانت:** Product → Variant → Inventory (S/M/L، سایز کفش 40/41/42، رنگ)
- **رزرو با چرخهٔ کامل:** VIP Request → Check Availability → Reservation (pending→active) → Confirmation/Release/Expiration/Cancellation
- **دفتر کل موجودی:** Inventory Ledger فقط حرکت موجودی (INCREASE/DECREASE/RESERVE/RELEASE/ADJUSTMENT) قابل ردیابی، نه مالی
- **جداسازی خرده/عمده سخت‌سازی:** Retail ONLY Kolbe products + Kolbe Seller Offer + Retail Price — Supplier Retail ممنوع؛ Wholesale Kolbe+Supplier مجاز
- **قوانین Seller Offer:** Supplier فقط wholesale_price/package/inventory، بدون retail؛ Kolbe retail+wholesale
- **آمادگی جریان عمده:** VIP → Request → Availability → Accept/Reject → Reservation → Order (مرزها بدون ساخت Order Engine)
- **مهاجرت امن:** legacy `supplier_product`/`supplier_variant`/`supplier_inventory` همچنان فعال برای سازگاری، بدون از دست رفتن داده، با برنامهٔ مهاجرت به کانونیکال

## Part 1 — Product Domain Authority — ممیزی

### وضعیت قبل

- دو منبع محصول: `product` (کانونیکال، ۴۲ جدول) و `supplier_product` (legacy، همچنان FK برای `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote`, `supplier_inventory`, `product_match_queue`)
- `frontend-next/server/kolbe-api.ts` همچنان INSERT/SELECT/UPDATE روی `supplier_product` و `supplier_variant` و `supplier_inventory` با `FOR UPDATE`
- `seller_offer.inventory_on_hand/reserved` تعریف شده با CHECK اما **هیچ سرویس آن را نمی‌خواند/نمی‌نویسد** — dead columns
- `supplier_inventory` منبع فعلی با منطق رزرو در legacy handler

### APIهای فعال

- `catalog` owns brand, category, product, product_media, product_variant, product_variant_media
- `products` owns supplier_product, supplier_variant (legacy)
- `offers` owns seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier, product_match_queue, rfq, quote
- `inventory` owns supplier_inventory (قبل) + جدید product_variant_inventory, inventory_reservation, inventory_ledger
- `vip` owns wholesale_account, vip_plan, vip_subscription, wholesale_request
- `frontend-next/server/kolbe-api.ts` — legacy active flows: product creation, variant list with inventory join, order fulfillment

### دو منبع محصول — ریسک

- Dual catalog drift: supplier_product جدید بدون تطبیق به product کانونیکال نمی‌رسد
- Retail leak: `CatalogService.searchProducts` و `listProducts` قبلاً بدون فیلتر channel همهٔ owner_typeها را برمی‌گرداند
- Seller singleton broken: `seller_supplier_unique` روی nullable supplier_id چند NULL می‌پذیرد — KOLBE singleton نیاز به partial index

### هدف

```
Canonical Product (product)
  ├─ Variants (product_variant) با attributes JSON
  ├─ Seller Offers
  │   ├─ Kolbe Offer (retail+wholesale, بدون کمیسیون، اولویت)
  │   └─ Supplier Offers (فقط عمده)
  ├─ Product Media (مشترک)
  └─ Offer Media (خاص فروشنده)
```

## Part 2 — Legacy Migration Strategy — Old → Migration Layer → New

### Old (فعال)

- `supplier_product` — id, supplier_id FK, name, sku unique, category, wholesale_price bigint, status
- `supplier_variant` — id, product_id FK supplier_product, sku unique, color, size, cost
- `supplier_inventory` — variant_id FK supplier_variant unique, on_hand, reserved, CHECK reserved<=on_hand

### Migration Layer (فاز ۳.۵)

1. **ایجاد کانونیکال از legacy:**
   - هر `supplier_product` → `product` با owner_type=SUPPLIER, status=draft, brand/category نگاشت
   - هر `supplier_variant` → `product_variant` با attributes {color, size} JSON, sku حفظ
   - هر `supplier` → `seller` با type=SUPPLIER, supplier_id FK
   - هر `seller` + `product` → `seller_offer` با wholesale_price از supplier_product, moq=1 PIECE
   - هر `supplier_inventory` → `product_variant_inventory` با variant_id جدید + seller_id, on_hand/reserved کپی

2. **سازگاری:**
   - `supplier_product` همچنان FK target برای wholesale_order_item, purchase_order_item, rfq, quote, product_match_queue
   - `supplier_variant` همچنان FK برای supplier_inventory (legacy) و wholesale_order_item
   - `supplier_inventory` همچنان برای legacy handler تا مهاجرت کامل
   - `product_variant_inventory` منبع جدید — dual-write در InventoryService

3. **Data Migration Plan (forward-only):**
   - migration 0006 — ایجاد ۳ جدول جدید بدون حذف legacy
   - script `migrate-legacy-to-canonical.ts` (planned فاز ۴):
     - برای هر supplier_product که هنوز canonical ندارد، product بساز
     - برای هر supplier_variant، product_variant بساز
     - برای هر supplier_inventory، product_variant_inventory upsert
     - لاگ در audit_log با action=legacy.migrated

4. **Compatibility:**
   - APIهای جدید فقط `product_variant_inventory` می‌خوانند
   - legacy handler `kolbe-api.ts` همچنان `supplier_inventory` می‌خواند تا زمان قطع
   - `seller_offer.inventory_on_hand/reserved` به عنوان کش قدیمی باقی می‌ماند، منبع حقیقت نیست

5. **Deprecation:**
   - فاز ۴: تمام خواندن‌ها به `product_variant_inventory` مهاجرت، dual-write متوقف، `supplier_inventory` read-only
   - فاز ۵: FKهای wholesale_order_item, purchase_order_item, rfq, quote به product/product_variant تغییر، legacy جداول archived

### New (هدف نهایی)

- `product` کانونیکال تنها منبع
- `product_variant` با attributes
- `seller` (KOLBE singleton + SUPPLIER per supplier)
- `seller_offer` (wholesale_price, retail_price فقط KOLBE)
- `product_variant_inventory` (variant_id + seller_id, on_hand, reserved, available=on_hand-reserved, status active/archived, مالک تأمین‌کننده)
- `inventory_reservation` (variant_id, seller_id, quantity, status pending/active/released/confirmed/expired/cancelled, expires_at, request_id FK wholesale_request)
- `inventory_ledger` (variant_id, seller_id, change_type INCREASE/DECREASE/RESERVE/RELEASE/ADJUSTMENT, quantity_delta, before/after on_hand/reserved, reason, actor_id, created_at)

## Part 3 — Inventory Authority — تعیین منبع حقیقت

### قبل

- `seller_offer.inventory_on_hand/reserved` — تعریف شده، CHECK دارد، اما هیچ service آن را نمی‌خواند/نمی‌نویسد — dead
- `supplier_inventory` — منبع فعلی با SELECT FOR UPDATE و reserved increment در `frontend-next/server/kolbe-api.ts`

### بعد — تصمیم

- **منبع حقیقت:** `product_variant_inventory` — موجودی در سطح واریانت + فروشنده، مالک تأمین‌کننده
- **Supplier owns inventory:** کلبه مالک موجودی تأمین‌کننده نمی‌شود — assertSupplierOwnsInventory فقط supplier role را محدود می‌کند
- **Marketplace View:** `seller_offer` inventory به عنوان نمایش/کش قدیمی، مشتق از `product_variant_inventory`
- **External sales:** تأمین‌کننده خارج از کلبه می‌فروشد → on_hand کاهش → ledger DECREASE با reason=external sale

### سرویس‌های خواندن/نوشتن

- **خواندن:**
  - `InventoryService.getVariantInventory` — variant_id + seller_id → on_hand/reserved/available
  - `listInventoriesForSeller` — با assertSupplierOwnsInventory
  - `checkPackageAvailability` — برای هر variant در بسته، available = on_hand - reserved، حداقل بسته = min(floor(available/required))

- **نوشتن:**
  - `upsertVariantInventory` — INCREASE/DECREASE با ledger
  - `createReservation` — assertInventoryCanReserve → INSERT reservation pending → UPDATE inventory reserved++ → ledger RESERVE → UPDATE reservation active
  - `releaseReservation` — reserved-- → ledger RELEASE → released/expired
  - `confirmReservation` — on_hand--, reserved-- → ledger DECREASE → confirmed → order

### معماری نهایی

```
Supplier Inventory System (source of truth)
  ↓ INCREASE/DECREASE/ADJUSTMENT + ledger
product_variant_inventory (variant_id + seller_id, on_hand, reserved, available)
  ↓ Availability Sync
Marketplace View (seller_offer + wholesale_package availability)
  ↓ Check
VIP Request (wholesale_request)
  ↓ Supplier Accept
Reservation (inventory_reservation pending→active, expires_at)
  ↓ Confirm
Order (wholesale_order) + ledger DECREASE
```

## Part 4 — Redesign Inventory Foundation

### Inventory Level

- جدول `product_variant_inventory`:
  - id PK, variant_id FK product_variant, seller_id FK seller, on_hand >=0, reserved >=0, reserved<=on_hand, status active/archived, created_at, updated_at
  - unique(variant_id, seller_id) — یک موجودی برای هر واریانت + فروشنده
  - index(seller_id)

### Reservation — VIP Request → Check → Reservation → Confirmation → Order

- جدول `inventory_reservation`:
  - id PK, variant_id FK product_variant, seller_id FK seller, quantity >=0, status pending/active/released/confirmed/expired/cancelled, expires_at nullable, request_id FK wholesale_request nullable, created_by FK account_user nullable, created_at, updated_at
  - index(variant_id, seller_id), index(status, expires_at)

- چرخه:
  - pending → active (supplier/admin/system) — رزرو فعال، reserved++
  - pending → cancelled (vip/supplier/admin/system) — لغو قبل فعال‌سازی
  - pending → expired (system) — انقضا قبل فعال‌سازی
  - active → confirmed (supplier/admin/system) — تأیید → on_hand--, reserved--, DECREASE ledger → order
  - active → released (supplier/admin/system/vip) — آزادسازی → reserved--, RELEASE ledger
  - active → expired (system) — cron انقضا
  - active → cancelled (supplier/admin/system) — لغو پس فعال‌سازی
  - released/confirmed/expired/cancelled → terminal

### Ledger — foundation only

- جدول `inventory_ledger`:
  - id PK, variant_id FK product_variant, seller_id FK seller, change_type INCREASE/DECREASE/RESERVE/RELEASE/ADJUSTMENT, quantity_delta, before_on_hand, after_on_hand, before_reserved, after_reserved, reason, actor_id FK account_user nullable, created_at
  - index(variant_id, created_at), index(seller_id, created_at)
  - فقط حرکت موجودی، نه مالی — برای ردیابی external sale, restock, reservation, release, adjustment

## Part 5 — Variant Level Inventory

### مثال‌ها

- **پوشاک:** Product Black Linen Shirt → Variants: S (attributes {size:S, color:Black}), M {size:M, color:Black}, L {size:L, color:Black} → Inventory: S:10, M:20, L:5 per seller
- **کفش:** Product Running Shoe → Variants: 40 {euSize:40}, 41 {euSize:41}, 42 {euSize:42} → Inventory: 40:10, 41:20, 42:5
- **اکسسوری:** Product Leather Bag → Variants: Black {color:Black}, White {color:White} → Inventory: Black:100, White:50

### بستهٔ عمده

- `wholesale_package` با type SIZE_RUN: S:2, M:2, L:2 → total 6
- Availability: min(floor(available_S/2), floor(available_M/2), floor(available_L/2)) = تعداد بستهٔ قابل عرضه
- اگر یک سایز 0 باشد، کل بسته 0

## Part 6 — Retail/Wholesale Isolation Hardening

### Retail ONLY Kolbe

- `CatalogService.listRetailProducts` → WHERE owner_type=KOLBE AND status=published
- `searchProducts(query, channel=retail)` → فقط KOLBE published
- `assertRetailIsolation(productId)` → اگر owner_type!=KOLBE → RETAIL_ONLY_KOLBE error
- `assertProductOwnership` — supplier نمی‌تواند KOLBE بسازد
- `assertOfferAllowedForProduct` — supplier نمی‌تواند retail_price داشته باشد

### Wholesale Kolbe+Supplier

- `listWholesaleProducts` → WHERE status=published (همه)
- `searchProducts(query, channel=wholesale)` → همهٔ published

### تست‌ها

- `retail-isolation.spec.ts`:
  - تأمین‌کننده نمی‌تواند محصول خرده بسازد
  - تأمین‌کننده نمی‌تواند پیشنهاد خرده (retail_price) بسازد
  - کلبه می‌تواند پیشنهاد خرده بسازد
  - تأمین‌کننده نمی‌تواند روی محصول انحصاری کلبه پیشنهاد بسازد
  - محصول انحصاری هیچ پیشنهاد تأمین‌کننده‌ای نمی‌پذیرد
  - محصول تأمین‌کننده نمی‌تواند در خرده‌فروشی باشد — فقط کلبه
  - عمده‌فروشی کلبه+تأمین‌کننده را می‌پذیرد
  - تأمین‌کننده فقط پیشنهاد خودش را می‌بیند

## Part 7 — Seller Offer Rules

- **Supplier:** فقط wholesale_price, package, inventory — بدون retail_price, بدون exclusive
- **Kolbe:** retail_price + wholesale_price, هر دو مجاز, بدون کمیسیون, اولویت 20% در ranking

### پیاده‌سازی

- `assertOfferAllowedForProduct`:
  - اگر productIsKolbeExclusive && sellerType=SUPPLIER → KOLBE_EXCLUSIVE_NO_SUPPLIER_OFFER
  - اگر sellerType=SUPPLIER && retailPrice!=null → SUPPLIER_CANNOT_SELL_RETAIL

## Part 8 — Prepare Wholesale Request Flow — مرزها بدون ساخت Order Engine

### جریان

```
VIP selects product → Request (pending)
  ↓ system → supplier_review
Supplier checks availability (product_variant_inventory)
  ↓ supplier accepts → accepted
System creates inventory_reservation (pending→active, expires_at)
  ↓ VIP confirms
ordered → reservation confirmed → inventory DECREASE + ledger → wholesale_order (future)
```

### Schema پشتیبانی می‌کند

- `vip_subscription` (active check)
- `wholesale_request` (pending, supplier_review, accepted, rejected, ordered, rejection_reason)
- `product_variant_inventory` (availability per variant+seller)
- `inventory_reservation` (reservation with expiration, request_id FK)
- `inventory_ledger` (trace)
- `wholesale_order` (future order creation — not built in 3.5)

### تست

- `wholesale-request-flow.spec.ts`:
  - VIP باید اشتراک فعال داشته باشد
  - VIP دسترسی فقط با اشتراک فعال
  - کمیت درخواست >= MOQ و <= available
  - جریان pending→supplier_review→accepted/rejected→ordered با نقش‌ها
  - رزرو پس از پذیرش — مرزها
  - schema پشتیبانی از VIP→Request→Availability→Accept/Reject→Reservation→Order

## Part 9 — Tests Required

### Product Authority — no bypass canonical, duplicate safe no auto-merge

- `product-authority.spec.ts`:
  - محصول کانونیکال باید از طریق Product ایجاد شود، نه مستقیم supplier_product برای خرده
  - تأمین‌کننده نمی‌تواند محصول انحصاری کلبه بسازد
  - تشخیص تکراری — بدون ادغام خودکار (slug یا name+brand+category)
  - بدون ادغام خودکار — صف تطبیق نیاز به تأیید ادمین
  - Seller Offer Rules — Supplier wholesale only
  - Migration Safety — legacy accessible no data loss (مستندسازی)

### Inventory — supplier owns inventory, variant-level, reservation lifecycle

- `inventory.logic.spec.ts` (21 تست):
  - مالکیت تأمین‌کننده
  - موجودی در سطح واریانت (available, insufficient, inactive)
  - رزرو چرخهٔ حیات (pending→active, pending→cancelled, active→confirmed, active→released, active→expired only system, released terminal, expiration detection)
  - دفتر کل (INCREASE, DECREASE, RESERVE, RELEASE)
  - بستهٔ عمده — حداقل موجودی

### Retail Isolation — supplier cannot appear in retail

- `retail-isolation.spec.ts` (8 تست) — شرح بالا

### Migration Safety — legacy accessible no data loss

- `clean-migration.test.ts` — مهاجرت روی دیتابیس خالی، 45 جدول، FK>=23، idempotent، بدون دادهٔ نمایشی
- `state-constraints.test.ts` — رانش وضعیت‌ها برای 45 جدول شامل جدید product_variant_inventory_status_allowed, inventory_reservation_status_allowed, inventory_ledger_change_type_allowed
- `startup-guard.test.ts` — نگهبان با 45 جدول
- `module-boundaries.test.ts` — مرزها با استثناهای فاز ۳.۵ (catalog/offers/vip/inventory/products/admin/ratings نیاز به cross-read برای تطبیق و انحصاری و موجودی)

## Part 10 — Docs

### این فایل — `docs/phase-reports/phase-3-5-report.md`

- مشکلات شناسایی‌شده
- تصمیم‌های معماری
- برنامهٔ مهاجرت
- مدل مالکیت موجودی
- APIهای منسوخ
- بدهی‌ها

### مشکلات شناسایی‌شده (قبل از فاز ۳.۵)

- Dual inventory truth: seller_offer.inventory_on_hand/reserved dead vs supplier_inventory active → race oversell
- Offer inventory per-offer not per-variant cannot represent SIZE_RUN S:10 M:20
- Supplier external sales makes both inaccurate — no ledger, no sync, no adjustment UI
- Retail leak: searchProducts/listProducts no channel filter, legacy supplier_product may leak via kolbe-api.ts
- Seller singleton broken: uniqueIndex on nullable supplier_id allows multiple KOLBE
- Package creation not transactional
- Money CHECK workaround [...PACKAGE_TYPES,""] for null
- Dual catalog drift, matching queue no admin flow, brand verification pending not enforced, category attributes_schema JSONB no validation, pricing tiers overlap not validated, supplier_permission_config not enforced no audit_log wiring, VIP expiry no cron, search ranking not persisted

### تصمیم‌های معماری

- Inventory Authority: Supplier owns inventory, variant-level, reservation with expiration, ledger traceable, Kolbe not owner
- Product Domain: Canonical Product → Seller Offer → Kolbe/Supplier, legacy supplier_product preserved with migration plan, no auto-merge, admin approval required
- Retail/Wholesale Isolation: Retail ONLY Kolbe, Wholesale Kolbe+Supplier, enforced at service + controller + tests
- Seller Offer Rules: Supplier wholesale only, Kolbe retail+wholesale
- Wholesale Request Flow: boundaries defined without building Order Engine, schema supports VIP→Request→Availability→Accept/Reject→Reservation→Order

### برنامهٔ مهاجرت Old→Migration Layer→New

- Old: supplier_product, supplier_variant, supplier_inventory (legacy active)
- Migration Layer: product_variant_inventory, inventory_reservation, inventory_ledger (جدید، منبع حقیقت), seller_offer inventory به عنوان کش قدیمی
- New: product کانونیکال تنها منبع، product_variant با attributes, seller, seller_offer, product_variant_inventory, inventory_reservation, inventory_ledger
- گام‌ها: ایجاد کانونیکال از legacy, dual-write, سازگاری, deprecation در فاز ۴/۵

### مدل مالکیت موجودی

- Supplier Inventory System (source of truth) → Availability Sync → Marketplace View → Reservation → Order
- Kolbe not owner — assertSupplierOwnsInventory فقط supplier role را محدود می‌کند
- Variant-level: Product→Variant→Inventory با available = on_hand - reserved
- Reservation: pending→active→confirmed/released/expired/cancelled با انقضا
- Ledger: INCREASE/DECREASE/RESERVE/RELEASE/ADJUSTMENT قابل ردیابی

### APIهای منسوخ

- `seller_offer.inventory_on_hand/reserved` — dead columns, منبع حقیقت نیست, منسوخ خواهد شد, به product_variant_inventory مهاجرت
- `supplier_inventory` — legacy, همچنان برای سازگاری تا فاز ۴, سپس read-only, سپس archived
- `frontend-next/server/kolbe-api.ts` legacy flows — باید به NestJS InventoryService مهاجرت

### بدهی‌ها و کار آینده

- seller_supplier_unique uniqueIndex روی nullable supplier_id — Postgres چند NULL می‌پذیرد, برای KOLBE singleton نیاز به partial index
- seller_offer package_type CHECK با workaround ["", ...PACKAGE_TYPES] برای null — باید به CHECK با OR null تغییر کند
- رتبه‌بندی فاکتورهای تبدیل/پاسخ/موجودی فعلاً پایه, نیاز به دادهٔ واقعی فروش و لاگ پاسخ تأمین‌کننده
- موتور تطبیق فعلاً بر اساس slug و نام+برند+دسته, نیاز به فازی‌مچ و تصویر
- مجوز تأمین‌کننده فعلاً در حافظه, نیاز به audit_log هر اقدام
- VIP Plan features/limits JSONB فعلاً آزاد, نیاز به اسکیمای اعتبارسنجی
- Rating foundation بدون میانگین‌گیری و ضد-اسپم
- Reservation expiration cron نیاز به پیاده‌سازی (system role)
- Package creation transactional نیاز به پیاده‌سازی
- Money CHECK برای wholesale_price/unit_price/price قبلاً 1e12 بود, به 1e15 اصلاح شد

## Verification Gates

### Before (6bc805d)

- db:migrate: 6 migrations, 42 tables, 54 FK, 84 CHECK
- typecheck:all: green
- test:all: 160+36+72+21=289 (frontend-next 160, database 36, api 72, shared 21)
- build: green
- infra:verify: green

### After (Phase 3.5)

- db:migrate: 7 migrations, 45 tables, 63 FK, 91 CHECK — مهاجرت 0006_phase_3_5_inventory اضافه شد
- typecheck:all: green
- test:all: 160+36+113+21=330 — 41 تست جدید (inventory 21, retail-isolation 8, product-authority 6, wholesale-request-flow 6)
- build: green (Next build + packages)
- infra:verify: green

### دستورات

```bash
npm run db:migrate
npm run typecheck:all
npm run test:all
npm run build
npm run infra:verify
```

همه سبز.

## کامیت‌ها

- `audit(marketplace): Phase 3 inventory and legacy audit` — read-only audit
- `feat(inventory): variant inventory, reservation, ledger tables` — migration 0006, state-values, tables, index
- `refactor(inventory): supplier owns inventory, variant-level, reservation lifecycle` — inventory.logic.ts, inventory.service.ts, module
- `feat(catalog): retail wholesale isolation hardening` — listRetailProducts, listWholesaleProducts, search channel, assertRetailIsolation, controller endpoints
- `test(marketplace): product authority, duplicate safe, inventory, retail isolation, wholesale flow` — 4 new spec files
- `docs(marketplace): phase 3.5 report with migration plan and inventory ownership` — this file
