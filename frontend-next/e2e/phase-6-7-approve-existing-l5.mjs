/**
 * فاز ۶.۷ — پذیرشِ مرورگریِ «تأیید — پیوند به محصولِ موجود» (approve-as-existing).
 *
 * روی پشتهٔ واقعی: PostgreSQL + NestJS + Next + Chromium.
 *
 * چه چیزی را اثبات می‌کند؟
 *  ۱) جریان کامل در UI واقعی کار می‌کند: ساپلایر ثبت می‌کند → ادمین کانون را جست‌وجو
 *     می‌کند → **صریحاً** انتخاب می‌کند → تأیید می‌کند.
 *  ۲) هویتِ محصولِ کانون حفظ می‌شود (نام/اسلاگ/مالک تغییر نمی‌کند).
 *  ۳) پیشنهادِ خودِ کلبه **بازنویسی نمی‌شود**.
 *  ۴) موجودیِ تأمین‌کننده در سطحِ فروشنده جدا می‌ماند.
 *  ۵) MOQ/SERIES و بستهٔ سری سایزبندی و پله‌های قیمت در دیتابیس حفظ می‌شوند.
 *  ۶) تأییدِ دوبارهٔ همان ثبت، تکراری نمی‌سازد (fail-closed).
 */
import { chromium } from 'playwright'
import pg from 'pg'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/home/user/kolbevintage-services/.browsers/bin/chromium'
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/kolbe'
const SUPPLIER = process.env.SUPPLIER_EMAIL ?? 'supplier@kolbe.test'
const ADMIN = process.env.ADMIN_EMAIL ?? 'admin@kolbe.test'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Kolbe!TestPassword123'
const CANONICAL = process.env.CANONICAL_PRODUCT_ID ?? 'prod_21fcb095722efbc15dbc79a8'
const CANONICAL_NAME = 'پیراهن لینن کانونیکال'
const TAG = Date.now().toString(36).toUpperCase().slice(-6)
const SKU_PREFIX = `EEXIST${TAG}`
const PRODUCT_NAME = `پیراهن لینن پیوند ${TAG}`
const SLUG = `eexisting-${TAG.toLowerCase()}`

/** Steps must be clicked inside `.spe-steps`; the left nav has same-named items. */
async function gotoStep(page, label) {
  await page.locator('.spe-steps button', { hasText: label }).first().click()
  await page.waitForTimeout(350)
}
async function waitForText(page, text, timeout = 60000) {
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), text, { timeout })
}

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS  ${name}`) }
  else { failures.push(`${name} — ${detail}`); console.log(`FAIL  ${name} — ${detail}`) }
}

const db = new pg.Client({ connectionString: DATABASE_URL })
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

try {
  await db.connect()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' })
  const page = await context.newPage()
  const unexpected = []
  page.on('pageerror', (error) => unexpected.push(String(error)))

  /* ── 1. ساپلایر: ساختِ محصول + ویرایشِ کامل تجاری ─────────────────────── */
  await page.goto(`${BASE}/supplier`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 60000 })
  await page.fill('input[type="email"]', SUPPLIER)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button.auth-submit')
  await waitForText(page, 'ثبت محصول جدید')
  check('supplier login reaches the portal', true)

  await page.goto(`${BASE}/supplier?page=product-editor`, { waitUntil: 'domcontentloaded' })
  await waitForText(page, 'نام محصول')
  await page.fill('label:has-text("نام محصول") input', PRODUCT_NAME)
  await page.fill('label:has-text("شناسهٔ یکتا") input', SLUG)
  await page.selectOption('label:has-text("دستهٔ کانونیک") select', { label: 'پیراهن لینن' })
  await page.selectOption('label:has-text("برند") select', { label: 'Kolbe Linen' })
  await page.fill('label:has-text("توضیحات") textarea', 'پیراهن لینن برای تأییدِ پیوندی.')

  await gotoStep(page, 'واریانت‌ها')
  await page.fill('label:has-text("پیشوندِ SKU") input', SKU_PREFIX)
  await page.fill('label:has-text("مقادیرِ ردیف") input', 'Black, Cream')
  await page.fill('label:has-text("مقادیرِ ستون") input', 'S, M, L')
  // Only the Black row (first three cells), so the graph stays small and the
  // staged SKUs are deterministic.
  for (let index = 0; index < 3; index += 1) {
    await page.locator('.spe-bulk-row button').nth(index).click()
    await page.waitForTimeout(200)
  }
  const skuInputs = page.locator('.spe-variant-card label:has-text("SKU") input')
  const allSkus = await skuInputs.evaluateAll((nodes) => nodes.map((node) => node.value))
  const blackSkus = allSkus.filter((sku) => sku.includes('BLACK')).sort()
  check('three staged variants created', blackSkus.length === 3, blackSkus.join(', '))

  // Inventory must be filled here: the approve-as-existing path upserts the
  // (variant, THIS seller) row only, and the check below proves Kolbe's own
  // inventory row is never touched.
  await gotoStep(page, 'موجودی')
  const invFields = page.locator('input[aria-label^="موجودیِ"]')
  const invCount = await invFields.count()
  check('inventory inputs are present for every staged variant', invCount === 3, `${invCount}`)
  for (let index = 0; index < invCount; index += 1) await invFields.nth(index).fill(String(40 + index * 10))

  await gotoStep(page, 'پیشنهادِ تجاری')
  await page.fill('label:has-text("SKU تجاری") input', `${SKU_PREFIX}-SHIRT`)
  await page.fill('label:has-text("قیمت عمده") input', '1250000')
  await page.fill('label:has-text("قیمت خرده") input', '1890000')
  await page.fill('label:has-text("حداقل تعداد سفارش") input', '2')
  await page.selectOption('label:has-text("واحدِ MOQ") select', 'SERIES')

  await gotoStep(page, 'سری / بسته‌ها')
  await page.click('button:has-text("افزودنِ بسته")')
  await page.fill('label:has-text("نامِ بسته") input', 'سری سایزبندی S-L')
  await page.selectOption('label:has-text("نوعِ بسته") select', 'SIZE_RUN')
  for (const sku of blackSkus) {
    await page.locator('label:has-text("افزودنِ واریانت به بسته") select').first().selectOption(sku)
    await page.waitForTimeout(250)
  }
  const qtyInputs = page.locator('input[aria-label^="تعدادِ"]')
  for (let index = 0; index < await qtyInputs.count(); index += 1) await qtyInputs.nth(index).fill('2')

  await gotoStep(page, 'پله‌های قیمت')
  const tierSpecs = [['2', '9', '1250000'], ['10', '49', '1180000'], ['50', '', '1090000']]
  for (const [, , price] of tierSpecs) {
    await page.click('button:has-text("افزودنِ پله")')
    await page.waitForTimeout(150)
    await page.locator('input[aria-label="قیمتِ واحد"]').last().fill(price)
  }
  const minInputs = page.locator('input[aria-label="حداقلِ تعداد"]')
  const maxInputs = page.locator('input[aria-label^="حداکثرِ تعداد"]')
  for (let index = 0; index < 3; index += 1) {
    await minInputs.nth(index).fill(tierSpecs[index][0])
    if (tierSpecs[index][1]) await maxInputs.nth(index).fill(tierSpecs[index][1])
  }

  await gotoStep(page, 'بازبینی')
  const submit = page.locator('button:has-text("ارسال برای بررسی")')
  await submit.click()
  await page.waitForSelector('text=برای بررسی ارسال شد', { timeout: 30000 })
  const sid = (await page.locator('text=/sps_/').first().textContent() ?? '').trim()
  check('supplier submitted the staged commercial graph', /^sps_/.test(sid), sid)

  /* ── 2. ادمین: جست‌وجوی کانون و انتخابِ **صریح** ──────────────────────── */
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' })
  const admin = await adminContext.newPage()
  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await admin.waitForSelector('input[name="admin-username"]', { timeout: 30000 })
  await admin.fill('input[name="admin-username"]', ADMIN)
  await admin.fill('input[name="admin-password"]', PASSWORD)
  await admin.click('form button[type="submit"]')
  await admin.waitForSelector('role=tab[name="مدیریت عمده‌فروشی"]', { timeout: 30000 })
  await admin.click('role=tab[name="مدیریت عمده‌فروشی"]')
  await admin.waitForTimeout(800)
  await admin.click('button:has-text("بازبینی محصولات ساپلایر")')
  await admin.waitForSelector('text=بازبینیِ محصولِ تأمین‌کنندگان', { timeout: 30000 })
  await admin.waitForFunction((name) => document.body.innerText.includes(name), PRODUCT_NAME, { timeout: 60000 })
  check('admin moderation lists the submission from the server', true)

  await admin.locator(`tr:has-text("${PRODUCT_NAME}") button:has-text("بازبینی")`).first().click()
  await admin.waitForSelector('text=پیشنهادِ تجاری و MOQ', { timeout: 30000 })
  const detailText = await admin.locator('body').innerText()
  check('admin sees MOQ with its unit before deciding', detailText.includes('سری'), detailText.slice(0, 120))
  check('admin sees the staged series composition', detailText.includes('سری سایزبندی S-L'))
  check('admin sees the open-ended tier', detailText.includes('۵۰+'))

  // The "existing" path must refuse to act until a canonical product is chosen.
  await admin.click('button:has-text("اتصال به محصولِ موجود")')
  await admin.waitForSelector('text=این پیشنهاد به محصولِ انتخاب‌شده متصل می‌شود', { timeout: 20000 })
  const confirmBefore = admin.locator('button:has-text("ثبتِ قطعی")')
  check('confirm is disabled before a canonical product is chosen', await confirmBefore.isDisabled())
  check('admin is forced to choose a canonical product explicitly', true)

  // The placeholder is unique to this control; the label text is ambiguous.
  await admin.fill('input[placeholder="پیراهن لینن"]', CANONICAL_NAME)
  await admin.click('button:has-text("جست‌وجو")')
  try {
    await admin.waitForFunction(() => document.querySelectorAll('input[name="canonical-product"]').length > 0, null, { timeout: 30000 })
  } catch {
    const dump = await admin.locator('form, .border-neutral-200.bg-neutral-50').first().innerText().catch(() => '')
    throw new Error(`canonical search produced no candidate radio. Panel text: ${dump.slice(0, 500)}`)
  }
  const candidates = await admin.locator('input[name="canonical-product"]').count()
  check('canonical search returned candidates from the server', candidates > 0, `${candidates}`)
  await admin.locator('input[name="canonical-product"]').first().check()
  await admin.waitForFunction(() => document.body.innerText.includes('مقصد:'), null, { timeout: 30000 })
  check('chosen canonical target is shown to the admin', true)

  await admin.click('button:has-text("ثبتِ قطعی")')
  await admin.waitForFunction(() => document.body.innerText.includes('تأیید شد — اتصال به محصولِ موجود'), null, { timeout: 90000 })
  check('approval as existing succeeded through the browser', true)

  /* ── 3. حقیقتِ دیتابیس ─────────────────────────────────────────────────── */
  const after = await db.query('SELECT id, name, slug, status, owner_type FROM product WHERE id = $1', [CANONICAL])
  const canonical = after.rows[0]
  check('canonical identity preserved', canonical?.name === CANONICAL_NAME && canonical?.slug === 'canonical-linen-shirt' && canonical?.owner_type === 'KOLBE', JSON.stringify(canonical))
  check('canonical product NOT re-owned by the supplier', canonical?.owner_type === 'KOLBE')

  const submissionAfter = await db.query('SELECT status, approved_product_id FROM supplier_product_submission WHERE id = $1', [sid])
  check('submission marked approved_existing_product', submissionAfter.rows[0]?.status === 'approved_existing_product', JSON.stringify(submissionAfter.rows[0]))
  check('submission links to the canonical product', submissionAfter.rows[0]?.approved_product_id === CANONICAL, JSON.stringify(submissionAfter.rows[0]))

  const offers = (await db.query("SELECT id, seller_id, sku, status, wholesale_price, currency, moq, moq_unit, variant_id FROM seller_offer WHERE product_id = $1 ORDER BY seller_id, sku", [CANONICAL])).rows
  const kolbeOffer = offers.find((o) => o.sku === 'KANON-LINEN-S')
  check('Kolbe offer not overwritten', kolbeOffer?.wholesale_price === '2000000' && kolbeOffer?.moq === 1 && kolbeOffer?.moq_unit === 'PIECE', JSON.stringify(kolbeOffer ?? null))
  const supplierOffer = offers.find((o) => o.sku === `${SKU_PREFIX}-SHIRT`)
  check('supplier offer materialized as published', supplierOffer?.status === 'published', JSON.stringify(supplierOffer ?? null))
  check('supplier offer keeps MOQ 2 with SERIES unit', supplierOffer?.moq === 2 && supplierOffer?.moq_unit === 'SERIES', JSON.stringify(supplierOffer ?? null))
  check('supplier offer keeps money as a decimal string', supplierOffer?.wholesale_price === '1250000', String(supplierOffer?.wholesale_price))

  const packages = (await db.query("SELECT id, package_type, total_pieces, name FROM wholesale_package WHERE offer_id = $1", [supplierOffer.id])).rows
  check('SIZE_RUN package materialized with 6 pieces', packages[0]?.package_type === 'SIZE_RUN' && packages[0]?.total_pieces === 6, JSON.stringify(packages))
  const tiers = (await db.query('SELECT min_quantity, max_quantity, unit_price FROM wholesale_pricing_tier WHERE offer_id = $1 ORDER BY min_quantity', [supplierOffer.id])).rows
  check('all three pricing tiers materialized with an open final one', tiers.length === 3 && tiers[2]?.max_quantity === null, JSON.stringify(tiers.map((t) => [t.min_quantity, t.max_quantity])))

  const inv = (await db.query('SELECT seller_id, on_hand FROM product_variant_inventory WHERE variant_id IN (SELECT id FROM product_variant WHERE product_id = $1) ORDER BY seller_id', [CANONICAL])).rows
  const sellerIds = [...new Set(inv.map((r) => r.seller_id))]
  check('inventory stays seller-scoped and separate', sellerIds.length >= 2, JSON.stringify(inv))
  const kolbeInv = inv.filter((r) => r.seller_id !== supplierOffer.seller_id)
  check('Kolbe own inventory untouched by the supplier approval',
    kolbeInv.length === 3 && kolbeInv.every((r) => [500, 600, 700].includes(Number(r.on_hand))),
    JSON.stringify(kolbeInv))
  const supplierInv = inv.filter((r) => r.seller_id === supplierOffer.seller_id)
  check('supplier inventory rows carry the staged on-hand values',
    supplierInv.length === 3 && supplierInv.every((r) => [40, 50, 60].includes(Number(r.on_hand))),
    JSON.stringify(supplierInv))

  const canonicalVariants = (await db.query("SELECT sku FROM product_variant WHERE product_id = $1 ORDER BY sku", [CANONICAL])).rows.map((r) => r.sku)
  check('canonical variants still present', canonicalVariants.filter((s) => s.startsWith('KANON-')).length === 3, JSON.stringify(canonicalVariants))
  // Staged variants are mapped onto the canonical product: an exact SKU is
  // reused, otherwise the attribute deep-match reuses an existing canonical
  // variant, otherwise a new one is created. So the invariant is not "three new
  // SKUs appear" but "every package item points at a variant of THIS product".
  const itemVariants = (await db.query('SELECT i.variant_id, v.product_id FROM wholesale_package_item i JOIN product_variant v ON v.id = i.variant_id WHERE i.package_id = $1', [packages[0].id])).rows
  check('package items resolve to variants of the canonical product (no orphans)',
    itemVariants.length === 3 && itemVariants.every((r) => r.product_id === CANONICAL), JSON.stringify(itemVariants))
  const attached = (await db.query('SELECT COUNT(*) AS n FROM product_variant WHERE product_id = $1', [CANONICAL])).rows[0].n
  check('canonical product holds both its own and the mapped staged variants', Number(attached) >= 3, String(attached))

  /* ── 4. تأییدِ دوباره — fail-closed ────────────────────────────────────── */
  const resub = await admin.request.post(`${BASE}/api/v1/catalog/supplier-submissions/${sid}/approve-existing`, {
    data: { productId: CANONICAL },
  })
  const resubBody = await resub.json().catch(() => ({}))
  const code = resubBody?.code ?? resubBody?.message ?? ''
  check('re-approving is refused with a 4xx domain error, never a 500', resub.status() >= 400 && resub.status() < 500, `status=${resub.status()} code=${code}`)
  const offerCount = (await db.query('SELECT COUNT(*) AS n FROM seller_offer WHERE product_id = $1 AND sku = $2', [CANONICAL, `${SKU_PREFIX}-SHIRT`])).rows[0].n
  check('no duplicate supplier offer created', Number(offerCount) === 1, String(offerCount))

  check('no unexpected page error during approve-as-existing', unexpected.length === 0, unexpected.slice(0, 2).join(' | '))
} catch (error) {
  check('flow completed without an unexpected exception', false, String(error).slice(0, 400))
} finally {
  await browser.close()
  await db.end()
}

console.log(`\n=== APPROVE-AS-EXISTING L5 SUMMARY: ${passed}/${passed + failures.length} checks passed ===`)
if (failures.length) {
  console.log('FAILED:')
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
}
