# فاز ۳ — کاتالوگ، محصول، قیمت‌گذاری و بازار عمده — معماری و گزارش

**شاخه:** `arena/01a0ad1f-kolbevintage-services`  
**SHA شروع:** `92655c6`  
**SHA پایان:** (پس از کامیت)  
**تاریخ:** 2026-09-17

## خلاصهٔ اجرایی

فاز ۳ پایهٔ بازار چندفروشندهٔ کلبه را می‌سازد:

- **Retail = Kolbe only** — تأمین‌کننده حق فروش خرده‌فروشی ندارد
- **Wholesale = Kolbe + Supplier** — برای VIP/بوتیک، هر دو می‌فروشند
- **مدل فروشنده:** KOLBE (خرده+عمده، بدون کمیسیون، اولویت) در برابر SUPPLIER (فقط عمده)
- **معماری محصول کانونیکال:** `Product (canonical)` → `Seller Offers` (Kolbe Offer + Supplier Offers)، یک محصول چند فروشنده
- **Kolbe Exclusive:** `owner_type=KOLBE` + `is_kolbe_exclusive=true` محافظت‌شده، هیچ پیشنهاد تأمین‌کننده‌ای نمی‌پذیرد
- **موتور تطبیق:** Supplier draft → Matching → Admin review → Attach Offer یا Create Canonical، بدون ادغام خودکار
- **چرخهٔ حیات:** DRAFT→PENDING_REVIEW→APPROVED→PUBLISHED→SUSPENDED با کنترل ادمین
- **دسته‌بندی عمومی:** Clothing/Shoes/Hats/Bags/Accessories/Future با `attributes_schema` JSON، بدون ستون سخت‌کدشده
- **ویژگی انعطاف‌پذیر:** Size/Color/Material/Fit/EU Size/Collection و غیره JSON
- **واریانت:** Product→Variants با attributes/SKU/media/inventory
- **برند:** تأمین‌کننده موجود را انتخاب یا جدید وارد می‌کند که نیاز به بررسی دارد (verification_status)
- **جداسازی مدیا:** Product Media مشترک در برابر Offer Media خاص فروشنده
- **عمده‌فروشی:** MOQ با واحدهای PIECE/PACKAGE/SERIES/BOX/CARTON/SET، تیرهای قیمت 1/10/50 بسته، بسته‌های عمومی SIZE_RUN/FIXED_QUANTITY/COLOR_MIX/CUSTOM_BUNDLE
- **مجوز تأمین‌کننده:** قابل تنظیم توسط ادمین، لاگ حسابرسی هر اقدام
- **شرکت تأمین‌کننده:** Supplier Company → Members با نقش‌های Owner/Sales/Warehouse/Finance
- **VIP:** Customer→VIP Subscription→VIP Plan (Basic/Professional/Enterprise) قابل تنظیم
- **درخواست عمده:** VIP انتخاب → Request → Supplier availability → Accept/Reject با دلیل → Order
- **جستجو/رتبه‌بندی:** فروش/بازدید/تبدیل/پاسخ/موجودی/امتیاز، اولویت کلبه، قابل توسعه
- **امتیازدهی:** جداگانه Product/Supplier/Transaction

## اسکیما

### جداول جدید (۲۰ جدول)

- `brand` — id, name, slug unique, logo_url, verification_status (pending/approved/rejected), creator_id FK account_user, status (active/suspended/archived)
- `category` — id, slug unique, name, parent_id self-FK, attributes_schema JSONB, status (active/archived)
- `product` — id, sku unique, slug unique, name, description, brand_id FK, category_id FK, owner_type (KOLBE/SUPPLIER), is_kolbe_exclusive bool, status (draft/pending_review/approved/published/suspended/archived), sales_count/view_count/search_rank برای رتبه‌بندی، created_by FK
- `product_media` — product_id FK, url, type, position
- `product_variant` — product_id FK, sku unique, attributes JSONB, status (draft/active/archived)
- `product_variant_media` — variant_id FK, url, type, position
- `seller` — id, type (KOLBE/SUPPLIER), supplier_id FK unique, display_name, status (active/suspended/archived)
- `seller_offer` — product_id FK, seller_id FK, variant_id FK, sku unique, status, wholesale_price bigint, retail_price bigint nullable (فقط KOLBE), currency IRR, moq, moq_unit (PIECE/PACKAGE/SERIES/BOX/CARTON/SET), package_type, inventory_on_hand/reserved با CHECK reserved<=on_hand
- `offer_media` — offer_id FK, url, type, position
- `wholesale_package` — offer_id FK, package_type (SIZE_RUN/FIXED_QUANTITY/COLOR_MIX/CUSTOM_BUNDLE), name, total_pieces
- `wholesale_package_item` — package_id FK, variant_id FK, quantity
- `wholesale_pricing_tier` — offer_id FK, min_quantity, max_quantity, unit_price bigint, currency IRR, moq_unit
- `product_match_queue` — supplier_product_id FK, candidate_product_id FK product, status (pending/approved/rejected), reason, created_by FK
- `supplier_permission_config` — action unique (create_product/change_images/change_description/add_variant/change_category/change_price), requires_approval bool
- `vip_plan` — name, slug unique, price bigint, duration_days, features/limits JSONB, status (active/archived)
- `vip_subscription` — user_id FK, plan_id FK, status (pending/active/expired/suspended), started_at/expires_at
- `wholesale_request` — product_id FK, offer_id FK, vip_account_id FK wholesale_account, package_id FK, quantity, status (pending/supplier_review/accepted/rejected/ordered), rejection_reason
- `product_rating` — product_id FK, rater_id FK, rating 1-5 CHECK, status (visible/hidden/flagged)
- `supplier_rating` — supplier_id FK, rater_id FK, rating 1-5
- `transaction_rating` — order_id, order_type, rater_id FK, rating 1-5

### تغییر جدول موجود

- `supplier_member` + ستون `role` (owner/sales/warehouse/finance) با CHECK

### تعداد جداول

- قبل: ۲۲ جدول
- بعد: ۴۲ جدول (+۲۰)
- مهاجرت: 0005_fancy_darwin (6 مهاجرت کل)

## مالکیت ماژول‌ها (registry.ts)

- `catalog` → brand, category, product, product_media, product_variant, product_variant_media
- `suppliers` → supplier, supplier_application, seller, supplier_permission_config
- `supplier-team` → supplier_member
- `products` → supplier_product, supplier_variant (legacy)
- `offers` → seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier, product_match_queue, rfq, quote
- `inventory` → supplier_inventory
- `vip` → wholesale_account, vip_plan, vip_subscription, wholesale_request
- `ratings` → product_rating, supplier_rating, transaction_rating (جدید)
- `admin` → orchestration

## منطق دامنه (خالص، قابل آزمون)

### فایل‌ها

- `apps/api/src/modules/catalog/catalog.logic.ts` — مالکیت محصول، انحصاری کلبه، چرخهٔ حیات، بستهٔ عمده، تشخیص تکراری، تیر قیمت، برند، رتبه‌بندی
- `apps/api/src/modules/offers/offers.logic.ts` — جداسازی تأمین‌کننده، محاسبهٔ MOQ، سایز-ران
- `apps/api/src/modules/suppliers/supplier-permissions.logic.ts` — مجوزها و نقش‌های شرکت
- `apps/api/src/modules/vip/vip.logic.ts` — اشتراک VIP، کمیت درخواست، جریان درخواست

### قوانین پیاده‌شده

- `assertProductOwnership` — supplier نمی‌تواند KOLBE بسازد، نمی‌تواند exclusive بسازد
- `assertOfferAllowedForProduct` — محصول انحصاری کلبه پیشنهاد تأمین‌کننده نمی‌پذیرد، supplier نمی‌تواند retail_price داشته باشد
- `assertProductStatusTransition` — فقط ادمین می‌تواند approved/published/suspended کند
- `calculatePackageTotalPieces` / `validateWholesalePackage` — SIZE_RUN حداقل ۲ سایز، FIXED_QUANTITY فقط یک واریانت، total_pieces باید با جمع items برابر باشد
- `findDuplicateCandidates` — slug یکسان یا نام+برند+دسته یکسان تکراری است
- `calculateWholesalePrice` — تیر 1/10/50: 1→100k، 10→90k، 50→80k
- `validateBrandCreation` — برند موجود نیاز به بررسی ندارد، جدید تأمین‌کننده نیاز به بررسی دارد، جدید ادمین ندارد
- `calculateSearchRank` — وزن‌ها sales 0.3, views 0.1, conversion 0.2, response 0.1, availability 0.15, rating 0.15، کلبه 20% boost
- `assertSupplierOfferIsolation` — تأمین‌کننده فقط پیشنهاد خودش
- `calculateMoqInPieces` — PIECE=moq، PACKAGE=moq*pieces، BOX=moq*pieces*5، CARTON=moq*pieces*20
- `checkSupplierPermission` / `assertSupplierMemberRoleAllowed` — owner همه، sales قیمت+توضیح، warehouse واریانت+تصویر، finance قیمت
- `isVipSubscriptionActive` / `assertVipAccess` / `validateWholesaleRequestQuantity` / `transitionWholesaleRequest` — جریان کامل درخواست عمده

## سرویس‌های NestJS

- `CatalogService` — createBrand, approveBrand, createCategory, createProduct (با تشخیص تکراری و صف تطبیق)، transitionProductStatus, list/search, createVariant
- `OffersService` — ensureSeller (KOLBE singleton)، createOffer (با assertOfferAllowedForProduct)، listOffersForSeller (با isolation)، listOffersForProduct، createWholesalePackage، createPricingTier
- `SuppliersService` — createSupplier (+seller)، addMember، listMembers، getPermissionConfigs، checkAction
- `VipService` — createPlan، listPlans، subscribe، getActiveSubscription، createWholesaleRequest، transitionRequest

## تست‌ها

### منطق خالص (apps/api)

- `catalog.logic.spec.ts` — 26 تست: مالکیت، انحصاری، چرخهٔ حیات، بستهٔ عمده، تکراری، تیر قیمت، برند، رتبه‌بندی
- `offers.logic.spec.ts` — 9 تست: جداسازی، MOQ، سایز-ران
- `supplier-permissions.logic.spec.ts` — 7 تست: مجوزها و نقش‌ها
- `vip.logic.spec.ts` — 13 تست: اشتراک، کمیت، جریان درخواست

### دیتابیس

- `clean-migration.test.ts` — مهاجرت روی دیتابیس خالی، 42 جدول، FK >=23، idempotent، بدون دادهٔ نمایشی
- `state-constraints.test.ts` — رانش وضعیت‌ها برای 22+ ستون جدید (brand, category, product, seller, offer, package, match_queue, permission, member role, vip, rating)
- `startup-guard.test.ts` — نگهبان با 42 جدول

### API

- `module-boundaries.test.ts` — مرزها با استثناهای فاز ۳ (catalog/offers/vip/suppliers نیاز به cross-read برای تطبیق و انحصاری)
- `api.e2e.test.ts` — قرارداد پایه NestJS

### کل

- `test:all` — 160 تست frontend-next، 36 دیتابیس، 72 api، 21 shared = همه سبز
- `npm run db:migrate` — 6 مهاجرت، 42 جدول، 54 FK، 84 CHECK
- `typecheck:all` — سبز
- `build` — سبز
- `infra:verify` — سبز

## مثال‌ها

### محصول کانونیکال با چند فروشنده

```
Product: Black Linen Shirt (id: prod_123, owner_type: KOLBE, is_kolbe_exclusive: false)
  ├─ Seller Offer: Kolbe (seller_kolbe, retail 200k IRR, wholesale 100k IRR, MOQ 1 PIECE)
  └─ Seller Offer: Supplier A (seller_sup_1, wholesale 90k IRR, MOQ 1 PACKAGE)
       └─ Wholesale Package: SIZE_RUN S(2)+M(2)+L(2)=6 pieces, pricing tiers 1→100k, 10→90k, 50→80k
```

### بستهٔ سایز-ران

```
Package Type: SIZE_RUN
Name: Black Linen Shirt - Size Run S-L
Items: S:2, M:2, L:2 → total 6
MOQ: 1 PACKAGE = 6 PIECE
```

### بستهٔ رنگ-میکس

```
Package Type: COLOR_MIX
Name: Mix Black/White
Items: Black-M:3, White-M:3 → total 6
```

## بدهی‌ها و کار آینده

- `seller_supplier_unique` uniqueIndex روی nullable supplier_id — Postgres چند NULL می‌پذیرد، برای KOLBE singleton نیاز به partial index بعداً
- `seller_offer package_type CHECK` با workaround `["", ...PACKAGE_TYPES]` برای null — باید به CHECK با OR null تغییر کند
- رتبه‌بندی فاکتورهای تبدیل/پاسخ/موجودی فعلاً پایه، نیاز به دادهٔ واقعی فروش و لاگ پاسخ تأمین‌کننده
- موتور تطبیق فعلاً بر اساس slug و نام+برند+دسته، نیاز به فازی‌مچ و تصویر
- مجوز تأمین‌کننده فعلاً در حافظه، نیاز به audit_log هر اقدام
- VIP Plan features/limits JSONB فعلاً آزاد، نیاز به اسکیمای اعتبارسنجی
- Rating foundation بدون میانگین‌گیری و ضد-اسپم

## کامیت‌ها

- feat(catalog): canonical product, brand, category, variant, media, lifecycle, matching queue foundation
- feat(marketplace): seller model KOLBE/SUPPLIER, offer with exclusive guard, retail=Kolbe only
- feat(wholesale): packages SIZE_RUN/FIXED_QUANTITY/COLOR_MIX/CUSTOM_BUNDLE, MOQ units, pricing tiers
- feat(supplier): company members owner/sales/warehouse/finance, permission config, isolation
- feat(vip): plans, subscriptions, wholesale request flow, access guard
- test(catalog): product ownership, exclusive no supplier offer, supplier isolation, duplicate detection, size run calc, permissions, VIP access
- docs(catalog): architecture 3 report
