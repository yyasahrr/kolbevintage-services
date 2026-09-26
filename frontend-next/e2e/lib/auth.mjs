/**
 * نرخ‌ limiting آگاهانه برای دروازه‌های مرورگری.
 *
 * چرا این فایل وجود دارد؟
 * `POST /api/v1/auth/login` در بک‌اند به `@RateLimit({ limit: 5, windowSeconds: 60,
 * scope: "ip" })` محدود است — یک کنترلِ امنیتیِ واقعی که **نباید** برای تست
 * ضعیف شود. اما هر سه دروازهٔ مرورگری از یک IP (۱۲۷.۰.۰.۱) اجرا می‌شوند و روی
 * هم بیش از ۵ ورود در دقیقه درخواست می‌کنند. نتیجهٔ عملی: ورودِ آخر با `429`
 * رد می‌شد، نشست هرگز ساخته نمی‌شد و دروازه به‌جای گزارشِ صادقانه، ۶۰ ثانیه
 * منتظرِ متنی می‌ماند که هرگز نمی‌آمد.
 *
 * این یک باگِ زیرساختِ تست است، نه باگِ محصول. راه‌حلِ درست: دروازه باید `429`
 * را **تشخیص دهد**، به اندازهٔ `Retry-After` صبر کند و دوباره تلاش کند؛ و اگر
 * باز هم نشد، خطای واقعی گزارش دهد — نه timeoutِ بی‌معنا.
 *
 * آنچه این فایل **نمی‌کند**: هیچ حدِ نرخِ تولید را بالا نمی‌برد و هیچ
 * assertion را شل نمی‌کند.
 */

const DEFAULT_ATTEMPTS = 4;

function cookieFrom(res) {
  const raw = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')]).filter(Boolean)[0];
  return raw ? String(raw).split(';')[0] : '';
}

function retryAfterSeconds(res, fallback = 61) {
  const header = res.headers.get('retry-after');
  const parsed = header ? Number.parseInt(header, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * ورودِ سمتِ Node با تلاشِ مجدد روی `429`.
 * هر پاسخِ غیرِ ۴۲۹ بلافاصله برگردانده می‌شود تا خطاهای واقعی پنهان نمانند.
 */
export async function apiLogin(apiBase, email, password, { attempts = DEFAULT_ATTEMPTS } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 429) {
      return { status: res.status, cookie: cookieFrom(res), attempts: attempt };
    }
    const wait = retryAfterSeconds(res);
    last = { status: 429, cookie: '', attempts: attempt };
    if (attempt === attempts) break;
    console.log(`  · login rate-limited (429) — waiting ${wait}s before attempt ${attempt + 1}`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
  throw new Error(
    `login for ${email} was rate-limited (429) on all ${attempts} attempts; ` +
    `last status ${last?.status}. This is the auth rate limit, not a credential failure.`,
  );
}

/**
 * ورودِ مرورگری با تشخیصِ `429` از روی پاسخِ واقعیِ شبکه.
 *
 * به‌جای حدس‌زدن از روی متنِ صفحه، پاسخِ `POST …/auth/*login` را گوش می‌دهد؛ اگر
 * `429` بود، به اندازهٔ `Retry-After` صبر می‌کند و دوباره تلاش می‌کند. اگر
 * ورود موفق بود ولی متنِ انتظار نیامد، همان خطای اصلی را گزارش می‌دهد.
 */
export async function browserLogin(page, { userSelector, passSelector, submitSelector, email, password, readyText, timeout = 60000, attempts = DEFAULT_ATTEMPTS }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let status = null;
    const onResponse = (response) => {
      const url = response.url();
      if (url.includes('/auth/login') || url.includes('/auth/supplier/login')) status = response.status();
    };
    page.on('response', onResponse);
    try {
      await page.fill(userSelector, email);
      await page.fill(passSelector, password);
      await page.click(submitSelector);
      try {
        await page.waitForFunction((needle) => document.body.innerText.includes(needle), readyText, { timeout });
        return { attempts: attempt, rateLimited: false };
      } catch (error) {
        lastError = error;
        if (status === 429) {
          const wait = 61;
          if (attempt < attempts) {
            console.log(`  · browser login rate-limited (429) — waiting ${wait}s before attempt ${attempt + 1}`);
            await new Promise((resolve) => setTimeout(resolve, wait * 1000));
            continue;
          }
          throw new Error(
            `browser login for ${email} was rate-limited (429) on all ${attempts} attempts. ` +
            `The auth endpoint allows 5 logins/60s per IP; space the gates out or run them in separate jobs.`,
          );
        }
        throw error;
      }
    } finally {
      page.off('response', onResponse);
    }
  }
  throw lastError ?? new Error(`browser login for ${email} failed after ${attempts} attempts`);
}
