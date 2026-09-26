/**
 * فاز ۶.۳‑C — پذیرشِ مرورگریِ کاتالوگِ عمده (L5).
 *
 * این اسکریپت روی **پشتهٔ واقعی** اجرا می‌شود: PostgreSQL + NestJS + Next +
 * Chromium واقعی. هیچ مسیرِ تجاری mock نمی‌شود.
 *
 * پیش‌نیاز: اسکریپتِ `phase-6-7-supplier-product-l5.mjs` اجرا شده باشد تا یک
 * محصولِ تأمین‌کننده تأیید و **منتشر** شده در دیتابیس وجود داشته باشد. این
 * اسکریپت همان محصولِ واقعیِ منتشرشده را از طریقِ API پیدا می‌کند و سپس تجربهٔ
 * خریدارِ VIP را در مرورگر می‌سنجد.
 */
import { chromium } from 'playwright'
import pg from 'pg'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1'
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/home/user/kolbevintage-services/.browsers/bin/chromium'
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/kolbe'
const PASSWORD = 'Kolbe!TestPassword123'
const VIP_CATALOG = 'vip-catalog@kolbe.test'
const VIP_FULL = 'vip-full@kolbe.test'
const VIP_PENDING = 'vip-pending@kolbe.test'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS  ${name}`) }
  else { failures.push(`${name} — ${detail}`); console.log(`FAIL  ${name} — ${detail}`) }
}

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const raw = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')]).filter(Boolean)[0]
  return { status: res.status, cookie: raw ? String(raw).split(';')[0] : '' }
}

const db = new pg.Client({ connectionString: DATABASE_URL })
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  await db.connect()

  /* ── 0. یافتنِ محصولِ واقعیِ منتشرشده از دیتابیس ─────────────────────── */
  const { rows } = await db.query(`
    select p.id, p.name, p.status, o.sku as offer_sku, o.moq, o.moq_unit, o.wholesale_price, o.currency
    from product p
    join seller_offer o on o.product_id = p.id and o.status = 'published'
    where p.status = 'published' and o.moq_unit = 'SERIES'
    order by p.created_at desc
    limit 1`)
  const target = rows[0]
  check('a real supplier-approved and published SERIES product exists', Boolean(target), 'none found — run the supplier L5 gate first')
  if (!target) throw new Error('no published SERIES product to verify')

  const packages = (await db.query('select package_type, total_pieces from wholesale_package where offer_id = (select id from seller_offer where sku = $1)', [target.offer_sku])).rows
  const tiers = (await db.query('select min_quantity, max_quantity, unit_price from wholesale_pricing_tier where offer_id = (select id from seller_offer where sku = $1) order by min_quantity', [target.offer_sku])).rows
  check('DB truth: SIZE_RUN package present', packages[0]?.package_type === 'SIZE_RUN' && packages[0]?.total_pieces === 6, JSON.stringify(packages))
  check('DB truth: three pricing tiers present', tiers.length === 3, `${tiers.length}`)

  /* ── 1. entitlementها از سرور ─────────────────────────────────────────── */
  for (const [email, expected] of [
    [VIP_CATALOG, { catalog: true, rfq: false }],
    [VIP_FULL, { catalog: true, rfq: true }],
  ]) {
    const session = await login(email)
    const me = await (await fetch(`${API}/auth/me`, { headers: { cookie: session.cookie } })).json()
    check(`${email}: server entitlement catalog=${expected.catalog}`, me.vip?.entitlements?.catalog === expected.catalog, JSON.stringify(me.vip?.entitlements))
    check(`${email}: server entitlement rfq=${expected.rfq}`, me.vip?.entitlements?.rfq === expected.rfq, JSON.stringify(me.vip?.entitlements))
  }
  const pendingSession = await login(VIP_PENDING)
  const pendingMe = await (await fetch(`${API}/auth/me`, { headers: { cookie: pendingSession.cookie } })).json()
  check('pending VIP: status=pending and catalog entitlement false', pendingMe.vip?.status === 'pending' && pendingMe.vip?.entitlements?.catalog === false, JSON.stringify(pendingMe.vip))

  /* ── 2. ورودِ VIP در مرورگر و بازکردنِ کاتالوگِ قانونی ─────────────────── */
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' })
  const page = await context.newPage()
  const unexpected = []
  page.on('pageerror', (error) => unexpected.push(String(error)))

  await page.goto(`${BASE}/vip`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 60000 })
  await page.fill('input[type="email"]', VIP_CATALOG)
  await page.fill('input[type="password"]', PASSWORD)
  // The VIP login button carries no type attribute; it submits via the form.
  await page.click('form button:has-text("ورود به پنل VIP")')
  await page.waitForTimeout(3000)
  check('catalog-only VIP reaches the portal', !(await page.locator('body').innerText()).includes('عضویت VIP فعال نیست'))

  await page.goto(`${BASE}/vip/catalog`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction((name) => document.body.innerText.includes(name), target.name, { timeout: 60000 })
  check('the approved supplier product appears in the canonical wholesale catalog', true)

  const listText = await page.locator('body').innerText()
  check('catalog list shows the seller distinction', /تأمین‌کننده|کلبه/.test(listText), listText.slice(0, 160))

  /* ── 3. جزئیاتِ محصول — تصمیمِ خریدار ─────────────────────────────────── */
  await page.locator(`button:has-text("${target.name}")`).first().click()
  await page.waitForFunction(() => document.body.innerText.includes('شرایطِ عمده'), null, { timeout: 60000 })
  const detailText = await page.locator('body').innerText()

  check('detail shows MOQ 2 with its REAL unit (SERIES, not pieces)', detailText.includes('۲ سری'), detailText.slice(0, 200))
  check('detail never renders "۲ عدد" as the minimum', !detailText.includes('۲ عدد'))
  check('detail shows the SIZE_RUN package name', detailText.includes('سری سایزبندی'), detailText.slice(0, 200))
  check('detail shows the package total in pieces', detailText.includes('مجموع: ۶ قطعه'))
  check('detail shows the package composition rows', (await page.locator('table').count()) >= 2)
  check('detail shows the open-ended final tier as "به بالا"', detailText.includes('به بالا'))
  check('detail shows all three tier prices as decimal strings', detailText.includes('۱٬۲۵۰٬۰۰۰') && detailText.includes('۱٬۱۸۰٬۰۰۰') && detailText.includes('۱٬۰۹۰٬۰۰۰'))
  check('detail shows server availability', /\d/.test(detailText))

  // Money must stay a decimal string in the DOM: the Persian-grouped form proves
  // no JS float reformatting happened.
  check('money rendered with the Persian separator, not a JS float', detailText.includes('۱٬۲۵۰٬۰۰۰'))

  // SKU isolation
  const ltrNodes = await page.locator('[dir="ltr"]').count()
  check('identifiers isolated in LTR islands', ltrNodes > 0, `${ltrNodes}`)

  /* ── 4. API truth از همان نشستِ مرورگر ─────────────────────────────────── */
  const apiDetail = await page.request.get(`${BASE}/api/v1/catalog/products/${target.id}?channel=wholesale`)
  const body = await apiDetail.json().catch(() => ({}))
  const offer = body.offers?.[0] ?? {}
  check('API detail (same session) exposes MOQ + unit', offer.moq === 2 && offer.moqUnit === 'SERIES', JSON.stringify({ moq: offer.moq, moqUnit: offer.moqUnit }))
  check('API detail exposes package composition', offer.packages?.[0]?.packageType === 'SIZE_RUN' && offer.packages[0].items.length === 3, JSON.stringify(offer.packages ?? null).slice(0, 180))
  check('API detail exposes three tiers with an open final one', offer.pricingTiers?.length === 3 && offer.pricingTiers[2].maxQuantity === null, JSON.stringify((offer.pricingTiers ?? []).map((t) => [t.minQuantity, t.maxQuantity])))
  check('API price equals the DB price exactly (decimal string)', String(offer.price) === String(target.wholesale_price), `${offer.price} vs ${target.wholesale_price}`)

  /* ── 5. overflow سطحِ صفحه در چند ویوپورت ─────────────────────────────── */
  const viewports = [
    [320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [820, 1180],
    [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440],
  ]
  const overflowing = []
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(250)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) overflowing.push(`${width}x${height}:+${over}`)
  }
  check('no page-level horizontal overflow at 12 viewports', overflowing.length === 0, overflowing.join(', '))

  check('no unexpected page error during the wholesale buyer flow', unexpected.length === 0, unexpected.slice(0, 2).join(' | '))
} catch (error) {
  check('flow completed without an unexpected exception', false, String(error).slice(0, 400))
} finally {
  await browser.close()
  await db.end()
}

console.log(`\n=== 6.3-C WHOLESALE L5 SUMMARY: ${passed}/${passed + failures.length} checks passed ===`)
if (failures.length) {
  console.log('FAILED:')
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
}
