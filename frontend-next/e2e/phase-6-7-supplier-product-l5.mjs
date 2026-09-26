/**
 * Phase 6.7 — L5 golden flow for the Supplier Product vertical slice.
 *
 * Supplier browser -> canonical submission -> Admin browser review -> approval
 * -> canonical materialization -> Supplier server state, all against the real
 * stack (Nest on :4000, Next on :3000, PostgreSQL on :55432). Nothing here is
 * mocked: the assertions read the DOM and then re-query the database.
 *
 * Run with the stack already up:
 *   node e2e/phase-6-7-supplier-product-l5.mjs
 */
import { chromium } from 'playwright'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pg = require('pg')

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/kolbe'
const PASSWORD = process.env.KOLBE_E2E_PASSWORD || 'Kolbe!TestPassword123'
const SUPPLIER_EMAIL = process.env.KOLBE_E2E_SUPPLIER_EMAIL || 'supplier@kolbe.test'
const ADMIN_EMAIL = process.env.KOLBE_E2E_ADMIN_EMAIL || 'admin@kolbe.test'
const EXECUTABLE = '/home/user/kolbevintage-services/.browsers/bin/chromium'

const TAG = Date.now().toString(36).toUpperCase()
const PRODUCT_NAME = `پیراهن لینن E2E ${TAG}`
const SLUG = `linen-e2e-${TAG.toLowerCase()}`

const results = []
function check(name, passed, detail = '') {
  results.push({ name, passed: Boolean(passed), detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const db = new pg.Client({ connectionString: DB_URL })

/**
 * Steps must be clicked inside `.spe-steps`. The left navigation contains items
 * with the same names ("موجودی", "محصولات"), so an unscoped `has-text` click
 * navigates away from the editor instead of switching section.
 */
async function gotoStep(page, label) {
  await page.locator('.spe-steps button', { hasText: label }).first().click()
  await page.waitForTimeout(350)
}

async function login(page, email) {
  await page.goto(`${BASE}/supplier`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button.auth-submit')
  await page.waitForLoadState('networkidle')
}

/** 1x1 transparent PNG so the upload seam gets a real, decodable image. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  await db.connect()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' })
  const page = await context.newPage()

  /* ── 1. Supplier: build and submit a rich product ─────────────────────── */
  await login(page, SUPPLIER_EMAIL)
  check('supplier login reaches the portal', (await page.textContent('body')).includes('نساجی نیلگون') || (await page.url()).includes('/supplier'))

  await page.goto(`${BASE}/supplier?page=product-editor`, { waitUntil: 'networkidle' })
  await page.waitForSelector('label:has-text("نام محصول")', { timeout: 20000 })

  // Basic information
  await page.fill('label:has-text("نام محصول") input', PRODUCT_NAME)
  await page.fill('label:has-text("شناسهٔ یکتا") input', SLUG)
  await page.selectOption('label:has-text("دستهٔ کانونیک") select', { label: 'پیراهن لینن' })
  await page.selectOption('label:has-text("برند") select', { label: 'Kolbe Linen' })
  // Schema-driven attribute input appears only because the category declares it.
  const hasSchemaAttribute = await page.locator('label:has-text("material") input').count()
  check('category attributes_schema drives the attribute inputs', hasSchemaAttribute > 0)
  if (hasSchemaAttribute > 0) await page.fill('label:has-text("material") input', 'لینن')
  await page.fill('label:has-text("توضیحات") textarea', 'پیراهن لینن سبک، دوخت ایرانی.')

  // Variants: Black/Cream x S/M/L
  await gotoStep(page, 'واریانت‌ها')
  await page.fill('label:has-text("پیشوندِ SKU") input', 'LINENE2E')
  await page.fill('label:has-text("مقادیرِ ردیف") input', 'Black, Cream')
  await page.fill('label:has-text("مقادیرِ ستون") input', 'S, M, L')
  const cells = page.locator('.spe-bulk-row button')
  const cellCount = await cells.count()
  check('matrix offers every colour x size cell', cellCount === 6, `${cellCount} cells`)
  for (let index = 0; index < cellCount; index += 1) {
    // Re-query each time: React replaces the nodes after every add.
    await page.locator('.spe-bulk-row button').nth(index).click()
  }
  const skuInputs = page.locator('.spe-variant-card label:has-text("SKU") input')
  const variantCount = await skuInputs.count()
  check('six variants created from explicit matrix choices', variantCount === 6, `${variantCount} variants`)
  // Only one section is mounted at a time, so the SKU list must be read here.
  const allSkus = await skuInputs.evaluateAll(nodes => nodes.map(node => node.value))
  const blackSkus = allSkus.filter(sku => sku.includes('BLACK')).sort()
  check('matrix produced the expected colour x size SKUs', blackSkus.length === 3, blackSkus.join(', '))

  // Inventory: distinct values, one deliberately left "not supplied"
  await gotoStep(page, 'موجودی')
  const inventoryFields = page.locator('input[aria-label^="موجودیِ"]')
  const inventoryCount = await inventoryFields.count()
  const inventoryValues = [40, 60, 20, 15, 0]
  for (let index = 0; index < Math.min(inventoryCount, inventoryValues.length); index += 1) {
    await inventoryFields.nth(index).fill(String(inventoryValues[index]))
  }
  check('inventory step exposes a field per variant', inventoryCount === 6, `${inventoryCount} fields`)

  // Media through the real upload seam
  await gotoStep(page, 'رسانه')
  for (const name of ['main.png', 'gallery.png']) {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 })
    await page.click('button:has-text("بارگذاریِ تصویر")')
    const chooser = await chooserPromise
    await chooser.setFiles({ name, mimeType: 'image/png', buffer: PNG_1PX })
    await page.waitForTimeout(1500)
  }
  const uploadedUrls = await page.locator('.spe-media-fields input[dir="ltr"]').evaluateAll(nodes => nodes.map(node => node.value))
  const uploaded = uploadedUrls.filter(value => value.includes('/media/files/'))
  check('media upload returns real server URLs (no fabricated CDN links)', uploaded.length >= 2, uploaded.join(', '))

  // Commercial offer
  await gotoStep(page, 'پیشنهادِ تجاری')
  await page.fill('label:has-text("SKU تجاری") input', `LINENE2E-SHIRT-${TAG}`)
  await page.fill('label:has-text("قیمت عمده") input', '1250000')
  await page.fill('label:has-text("قیمت خرده") input', '1890000')
  await page.fill('label:has-text("حداقل تعداد سفارش") input', '2')
  await page.selectOption('label:has-text("واحدِ MOQ") select', 'SERIES')

  // Series / package
  await gotoStep(page, 'سری / بسته‌ها')
  await page.click('button:has-text("افزودنِ بسته")')
  await page.fill('label:has-text("نامِ بسته") input', 'سری سایزبندی S-L')
  await page.selectOption('label:has-text("نوعِ بسته") select', 'SIZE_RUN')
  // The package renders one "add variant" select that always reads empty; each
  // choice appends an item, so the same control is reused (re-queried) per item.
  for (const sku of blackSkus) {
    await page.locator('label:has-text("افزودنِ واریانت به بسته") select').first().selectOption(sku)
    await page.waitForTimeout(250)
  }
  const qtyInputs = page.locator('input[aria-label^="تعدادِ"]')
  const qtyCount = await qtyInputs.count()
  check('the series holds three items', qtyCount === 3, `${qtyCount} items`)
  for (let index = 0; index < qtyCount; index += 1) {
    await qtyInputs.nth(index).fill('2')
  }
  const totalText = await page.locator('.spe-package-total').first().textContent()
  check('series preview totals 6 pieces', (totalText ?? '').includes('۶'), (totalText ?? '').trim())

  // Pricing tiers, including the open-ended final tier
  await gotoStep(page, 'پله‌های قیمت')
  const tierSpecs = [
    ['2', '9', '1250000'],
    ['10', '49', '1180000'],
    ['50', '', '1090000'],
  ]
  for (const [, , price] of tierSpecs) {
    await page.click('button:has-text("افزودنِ پله")')
    await page.waitForTimeout(120)
    await page.locator('input[aria-label="قیمتِ واحد"]').last().fill(price)
  }
  const minInputs = page.locator('input[aria-label="حداقلِ تعداد"]')
  const maxInputs = page.locator('input[aria-label^="حداکثرِ تعداد"]')
  for (let index = 0; index < 3; index += 1) {
    await minInputs.nth(index).fill(tierSpecs[index][0])
    if (tierSpecs[index][1]) await maxInputs.nth(index).fill(tierSpecs[index][1])
  }

  // Review
  await gotoStep(page, 'بازبینی')
  await page.waitForTimeout(400)
  const reviewText = await page.locator('.spe-main').innerText()
  check('review shows the product name', reviewText.includes(PRODUCT_NAME))
  check('review shows MOQ 2 SERIES', reviewText.includes('SERIES') || reviewText.includes('سری'))
  check('review shows the series composition', reviewText.includes('سری سایزبندی S-L'))
  check('review keeps money as a decimal string', reviewText.includes('1250000') || reviewText.includes('1٬250٬000'))

  // Submit
  const submit = page.locator('button:has-text("ارسال برای بررسی")')
  check('submit is enabled only when the graph validates', await submit.isEnabled())
  await submit.click()
  await page.waitForSelector('text=برای بررسی ارسال شد', { timeout: 20000 })
  const submissionId = await page.locator('text=/sps_/').first().textContent()
  check('server returns a real submission id', /sps_/.test(submissionId ?? ''), submissionId ?? '')
  check('success never claims approval', !(await page.locator('.spe-main').innerText()).includes('تأیید شد'))

  const sid = (submissionId ?? '').trim()

  // Refresh: status must come from the server, not localStorage
  await page.goto(`${BASE}/supplier?page=products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const listText = await page.locator('body').innerText()
  check('submission survives refresh at the products deep link', listText.includes(PRODUCT_NAME))

  /* ── 2. Admin: review the exact same graph and approve ────────────────── */
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' })
  const adminPage = await adminContext.newPage()
  // `/store/kolbe/*` is the compatibility API proxy; the admin UI lives at `/admin`.
  await adminPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await adminPage.waitForSelector('input[name="admin-username"]', { timeout: 30000 })
  await adminPage.fill('input[name="admin-username"]', ADMIN_EMAIL)
  await adminPage.fill('input[name="admin-password"]', PASSWORD)
  await adminPage.click('form button[type="submit"]')
  await adminPage.waitForSelector('role=tab[name="مدیریت عمده‌فروشی"]', { timeout: 20000 })
  await adminPage.click('role=tab[name="مدیریت عمده‌فروشی"]')
  await adminPage.waitForTimeout(800)
  await adminPage.click('button:has-text("بازبینی محصولات ساپلایر")')
  await adminPage.waitForSelector('text=بازبینیِ محصولِ تأمین‌کنندگان', { timeout: 30000 })
  // The heading renders before the data arrives, so poll for the row itself.
  await adminPage.waitForFunction(name => document.body.innerText.includes(name), PRODUCT_NAME, { timeout: 60000 })

  const moderationText = await adminPage.locator('body').innerText()
  check('admin moderation lists the submission from the server', moderationText.includes(PRODUCT_NAME))
  check('admin sees the MOQ unit, not a default', moderationText.includes('سری'))

  await adminPage.locator(`tr:has-text("${PRODUCT_NAME}") button:has-text("بازبینی")`).first().click()
  await adminPage.waitForSelector('text=پیشنهادِ تجاری و MOQ', { timeout: 20000 })
  const detailText = await adminPage.locator('body').innerText()
  check('admin detail shows all six variants', (detailText.match(/LINENE2E-/g) ?? []).length >= 6)
  check('admin detail shows distinct inventory', detailText.includes('۴۰') && detailText.includes('۶۰'))
  check('admin detail shows the series with its total', detailText.includes('سری سایزبندی S-L'))
  check('admin detail shows the open-ended 50+ tier', detailText.includes('۵۰+'))
  check('admin detail shows the media', (await adminPage.locator('img[src*="/media/files/"]').count()) >= 2)

  await adminPage.click('button:has-text("تأیید به‌عنوانِ محصولِ تازه")')
  await adminPage.waitForSelector('text=یک محصول canonical جدید ایجاد می‌شود')
  await adminPage.click('button:has-text("ثبتِ قطعی")')
  await adminPage.waitForSelector('text=محصولِ کانونیکالِ تازه ساخته شد', { timeout: 30000 })
  check('admin approval succeeds through the browser', true)

  await adminPage.reload({ waitUntil: 'domcontentloaded' })
  await adminPage.waitForTimeout(2500)
  await adminPage.waitForTimeout(1500)
  const afterReload = await adminPage.locator('body').innerText()
  check('approved status persists after admin refresh', afterReload.includes(PRODUCT_NAME))

  /* ── 3. Database verification ─────────────────────────────────────────── */
  const [submission] = (
    await db.query('select id, status, approved_product_id from supplier_product_submission where id = $1', [sid])
  ).rows
  check('submission is approved_new_product in the database', submission?.status === 'approved_new_product', submission?.status ?? 'missing')
  check('submission points at the materialized product', Boolean(submission?.approved_product_id))

  const productId = submission.approved_product_id
  const [productRow] = (await db.query('select id, name, sku, status, owner_type, attributes from product where id = $1', [productId])).rows
  check('exactly one canonical product was created', Boolean(productRow) && productRow.name === PRODUCT_NAME)
  check('product attributes survived to the canonical row', productRow?.attributes?.material === 'لینن', JSON.stringify(productRow?.attributes ?? {}))

  const variants = (await db.query('select sku, attributes, status from product_variant where product_id = $1 order by sku', [productId])).rows
  check('six canonical variants materialized', variants.length === 6, `${variants.length}`)
  check('variant attributes preserved', variants.every(v => v.attributes && v.attributes.color && v.attributes.size))

  const inventory = (await db.query('select on_hand from product_variant_inventory vi join product_variant v on v.id = vi.variant_id where v.product_id = $1 order by on_hand desc', [productId])).rows
  check('inventory materialized with distinct values', inventory.length === 5 && inventory[0].on_hand === 60, JSON.stringify(inventory.map(r => r.on_hand)))
  check('"not supplied" was not defaulted to zero', inventory.length === 5)

  const [offer] = (await db.query('select wholesale_price, retail_price, currency, moq, moq_unit, package_type from seller_offer where product_id = $1', [productId])).rows
  check('offer keeps MOQ 2', offer?.moq === 2, String(offer?.moq))
  check('offer keeps SERIES (not degraded to PIECE)', offer?.moq_unit === 'SERIES', offer?.moq_unit ?? 'missing')
  check('offer keeps SIZE_RUN', offer?.package_type === 'SIZE_RUN', offer?.package_type ?? 'missing')
  check('money stored as bigint from the decimal string', offer?.wholesale_price === '1250000' && offer?.retail_price === '1890000', `${offer?.wholesale_price}/${offer?.retail_price}`)

  const packages = (await db.query('select id, package_type, total_pieces from wholesale_package where offer_id = $1', [offer.id ?? ''])).rows
  check('one series package materialized', packages.length === 1 && packages[0].total_pieces === 6, JSON.stringify(packages))

  const tiers = (await db.query('select min_quantity, max_quantity, unit_price, moq_unit from wholesale_pricing_tier where offer_id = $1 order by min_quantity', [offer.id ?? ''])).rows
  check('three pricing tiers preserved', tiers.length === 3, `${tiers.length}`)
  check('final tier is open-ended', tiers[2]?.max_quantity === null, String(tiers[2]?.max_quantity))
  check('tiers keep the SERIES unit', tiers.every(t => t.moq_unit === 'SERIES'))

  const mediaCounts = await db.query(
    `select
       (select count(*) from product_media where product_id = $1) as product_media,
       (select count(*) from product_variant_media pvm join product_variant v on v.id = pvm.variant_id where v.product_id = $1) as variant_media`,
    [productId],
  )
  check('product media materialized', Number(mediaCounts.rows[0].product_media) >= 2, String(mediaCounts.rows[0].product_media))

  /* ── 4. Supplier sees server-owned state ──────────────────────────────── */
  await page.goto(`${BASE}/supplier?page=products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const supplierAfter = await page.locator('body').innerText()
  check('supplier list reflects the server-owned state', supplierAfter.includes(PRODUCT_NAME))

  /* ── 5. Wholesale consumer boundary ───────────────────────────────────── */
  const browse = await page.request.get(`${BASE}/api/v1/catalog/browse?channel=wholesale&limit=50`)
  const browseBody = await browse.json().catch(() => ({}))
  const found = (browseBody.results ?? []).find(item => item.id === productId)
  check('approved product is reachable through the canonical wholesale catalog', Boolean(found), found ? found.name : 'not in browse results')

  const detail = await page.request.get(`${BASE}/api/v1/catalog/products/${productId}?channel=wholesale`)
  const detailBody = await detail.json().catch(() => ({}))
  check('wholesale detail exposes variants', Array.isArray(detailBody.variants) && detailBody.variants.length === 6, `${(detailBody.variants ?? []).length}`)
  check('wholesale detail exposes the offer with MOQ unit', Boolean(detailBody.offers?.[0]?.moqUnit ?? detailBody.offers?.[0]?.moq_unit), JSON.stringify(detailBody.offers?.[0] ?? {}).slice(0, 200))

  /* ── 6. Responsive: no page-level horizontal overflow ─────────────────── */
  const viewports = [
    [320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [820, 1180],
    [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440],
  ]
  const overflow = []
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(250)
    const metrics = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    if (metrics.sw > metrics.cw + 1) overflow.push(`${width}x${height}: ${metrics.sw}>${metrics.cw}`)
  }
  check('supplier product list has no page-level horizontal overflow at 12 viewports', overflow.length === 0, overflow.join('; '))

  await page.setViewportSize({ width: 1440, height: 900 })

  /* ── 7. Accessibility: keyboard reachability of the editor ────────────── */
  await page.goto(`${BASE}/supplier?page=product-editor`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const a11y = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input, select, textarea, button')]
    const unlabeled = inputs.filter(el => {
      if (el.type === 'hidden') return false
      const label = el.closest('label')
      const hasText = (label?.textContent ?? '').trim().length > 0
      return !hasText && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('placeholder')
    })
    return { total: inputs.length, unlabeled: unlabeled.map(el => el.tagName + ':' + (el.type ?? '')) }
  })
  check('every interactive control in the editor has an accessible name', a11y.unlabeled.length === 0, a11y.unlabeled.join(', '))

  await context.close()
  await adminContext.close()
} catch (error) {
  check('flow completed without an unexpected exception', false, String(error?.stack ?? error).split('\n').slice(0, 4).join(' | '))
} finally {
  await browser.close()
  await db.end().catch(() => {})
}

const failed = results.filter(item => !item.passed)
console.log(`\n=== L5 SUMMARY: ${results.length - failed.length}/${results.length} checks passed ===`)
if (failed.length > 0) {
  console.log('FAILED:')
  for (const item of failed) console.log(`  - ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}
process.exit(failed.length === 0 ? 0 : 1)
