/**
 * استودیوی طراحی سایت — بک‌اند اختصاصی (پاسخ ۵۰ کاربر).
 *
 * ── چرا ماژول جدا؟ ───────────────────────────────────────────────────────────
 * تا پیش از این، ذخیرهٔ تنظیمات ظاهر از سمت مرورگر به
 * `PUT /store/kolbe/admin/site-settings` می‌رفت و آن مسیر به سرویس CMS بیرونی
 * پروکسی می‌شد؛ اگر آن سرویس بالا نبود، ذخیره **بی‌صدا** از دست می‌رفت و تنها
 * کپی مرورگر (localStorage) می‌ماند. حالا خود همین مخزن، منبع حقیقت است:
 *
 *   • پیش‌نویس و منتشرشده از هم جدا هستند (`status`).
 *   • هر ذخیره/انتشار یک ردیف تازه در `site_design_revision` می‌سازد (تاریخچه).
 *   • انتشار، نسخهٔ پیشین را آرشیو می‌کند و همان بار را در `site_setting`
 *     می‌نویسد تا مسیر قدیمی `GET site/settings` هم سازگار بماند.
 *   • هر عملیات در `audit_log` ثبت می‌شود (چه کسی، چه زمانی، با چه یادداشتی).
 *
 * ── قواعد اعتبارسنجی ────────────────────────────────────────────────────────
 * کلیدهای مجاز بسته است، حجم بار سقف دارد و ویدیوی Base64 داخل تنظیمات
 * پذیرفته نمی‌شود (جای آن فایل/استریم است). این محدودیت‌ها همان چیزی است که
 * یک مدیر با توکن دزدیده‌شده هم نمی‌تواند دور بزند.
 */
import { randomUUID } from "node:crypto";
import { rows, transaction } from "./database";
import { HttpError } from "./http-error";
// قفل سبک در لایهٔ کلاینت هم استفاده می‌شود؛ ماژول خالص است و وابستگی سروری ندارد.
import { countLockedStrings, enforceStyleLock } from "../storefront/lib/styleLock";

/** کلید تنظیمات ظاهر در `site_setting` و `site_design_revision`. */
export const SITE_DESIGN_SETTING_KEY = "storefront";

/** سقف حجم پیش‌نویس (JSON) — تنظیمات ظاهر هیچ‌گاه نباید به این حد برسد. */
export const SITE_DESIGN_MAX_BYTES = 512 * 1024;

/** تعداد نسخه‌هایی که در تاریخچه برگردانده می‌شود. */
export const SITE_DESIGN_HISTORY_LIMIT = 25;

/**
 * بخش‌های مجاز تنظیمات ظاهر. کلید ناشناس ⇒ خطای ۴۲۲ (نه ذخیرهٔ خاموش).
 * این فهرست همان چیزی است که استودیو ویرایش می‌کند: تم و رنگ، فونت، هدر،
 * فوتر و بلوک‌های صفحه.
 */
export const SITE_DESIGN_SECTIONS = [
  "theme",
  "designSystem",
  "header",
  "hero",
  "heroStudio",
  "categories",
  "collectionBanner",
  "footer",
  "builder",
] as const;

export type SiteDesignSettings = Record<string, unknown>;

export type SiteDesignRevision = {
  id: string;
  status: "draft" | "published" | "archived";
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  payload?: SiteDesignSettings;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** مسیرهای اختصاصی ویدیو؛ همان‌هایی که `GET site/hero-video` و `banner-video` سرو می‌کنند. */
const HERO_VIDEO_URL = "/store/kolbe/site/hero-video";
const BANNER_VIDEO_URL = "/store/kolbe/site/banner-video";

const isEmbeddedVideo = (value: unknown): value is string => typeof value === "string" && /^data:video\//i.test(value);

/**
 * ویدیوی Base64 را از بار ذخیره بیرون می‌کشد و به مسیر اختصاصی ویدیو اشاره می‌دهد.
 *
 * چرا خطا نمی‌دهیم؟ چون رفتارِ منتشرشدهٔ فعلی همین است: ویدیو در جدول جداگانه
 * نگه داشته می‌شود و `GET site/settings` جای آن آدرس مسیر اختصاصی را می‌فرستد.
 * اگر اینجا ۴۲۲ بدهیم، مدیری که ویدیو را از همان پنل بارگذاری کرده دیگر
 * نمی‌تواند ذخیره کند — یعنی رگرسیون. در عوض، همان تبدیل را سمت نوشتن هم
 * انجام می‌دهیم تا نسخهٔ ذخیره‌شده با نسخهٔ خوانده‌شده یکی باشد.
 */
function stripEmbeddedVideos(settings: SiteDesignSettings) {
  let stripped = 0;
  const result: SiteDesignSettings = { ...settings };
  const heroStudio = result.heroStudio;
  if (isPlainObject(heroStudio) && isEmbeddedVideo((heroStudio as Record<string, unknown>).heroVideo)) {
    result.heroStudio = { ...heroStudio, heroVideo: HERO_VIDEO_URL };
    stripped += 1;
  }
  const builder = result.builder;
  if (isPlainObject(builder) && isPlainObject((builder as Record<string, unknown>).banner)) {
    const banner = (builder as Record<string, unknown>).banner as Record<string, unknown>;
    if (banner.mediaType === "video" && isEmbeddedVideo(banner.media)) {
      result.builder = { ...builder, banner: { ...banner, media: BANNER_VIDEO_URL } };
      stripped += 1;
    }
  }
  return { settings: result, stripped };
}

/**
 * اعتبارسنجی بار پیش‌نویس/انتشار.
 * خطاها کد قراردادی دارند تا کلاینت بتواند پیام دقیق فارسی نشان دهد.
 */
export function validateSiteDesignSettings(input: unknown): SiteDesignSettings {
  if (!isPlainObject(input)) throw new HttpError(422, "INVALID_SITE_DESIGN");
  const keys = Object.keys(input);
  if (keys.length === 0) throw new HttpError(422, "EMPTY_SITE_DESIGN");
  const unknownKeys = keys.filter((key) => !(SITE_DESIGN_SECTIONS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) throw new HttpError(422, "INVALID_SITE_DESIGN_KEYS", `بخش ناشناس: ${unknownKeys.join(", ")}`);

  // قفل سبک: هر رنگ ممنوعهٔ جامانده در تنظیمات (از جمله مقادیر قدیمی مرورگر)
  // پیش از ذخیره به توکن معتبر تبدیل می‌شود، پس دیگر نمی‌تواند برگردد.
  const { settings } = stripEmbeddedVideos(enforceStyleLock(input));
  let serialized: string;
  try {
    serialized = JSON.stringify(settings);
  } catch {
    throw new HttpError(422, "INVALID_SITE_DESIGN");
  }
  if (Buffer.byteLength(serialized, "utf8") > SITE_DESIGN_MAX_BYTES) {
    throw new HttpError(413, "SITE_DESIGN_TOO_LARGE", "حجم تنظیمات ظاهر بیش از حد مجاز است.");
  }
  return settings;
}

function toRevision(row: any, withPayload = false): SiteDesignRevision {
  return {
    id: String(row.id),
    status: row.status === "published" ? "published" : row.status === "archived" ? "archived" : "draft",
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    publishedAt: row.published_at ? (row.published_at instanceof Date ? row.published_at.toISOString() : String(row.published_at)) : null,
    ...(withPayload ? { payload: (row.payload ?? {}) as SiteDesignSettings } : {}),
  };
}

/** وضعیت کامل استودیو برای پنل مدیریت: پیش‌نویس، منتشرشده و تاریخچه. */
export async function loadSiteDesignState() {
  const [draft] = await rows<any>(
    "SELECT * FROM site_design_revision WHERE setting_key=$1 AND status='draft' ORDER BY created_at DESC LIMIT 1",
    [SITE_DESIGN_SETTING_KEY],
  );
  const [published] = await rows<any>(
    "SELECT * FROM site_design_revision WHERE setting_key=$1 AND status='published' ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1",
    [SITE_DESIGN_SETTING_KEY],
  );
  const history = await rows<any>(
      `SELECT id, status, note, created_by, created_at, published_at FROM site_design_revision
     WHERE setting_key=$1 AND (status <> 'draft' OR id = $2)
     ORDER BY created_at DESC LIMIT ${SITE_DESIGN_HISTORY_LIMIT}`,
    [SITE_DESIGN_SETTING_KEY, draft?.id ?? null],
  );
  return {
    settingKey: SITE_DESIGN_SETTING_KEY,
    draft: draft ? toRevision(draft, true) : null,
    published: published ? toRevision(published, true) : null,
    revisions: history.map((row) => toRevision(row)),
  };
}

/** نسخهٔ منتشرشدهٔ ظاهر — برای مصرف عمومی فروشگاه. */
export async function loadPublishedSiteDesign() {
  const [row] = await rows<any>(
    "SELECT payload, published_at FROM site_design_revision WHERE setting_key=$1 AND status='published' ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1",
    [SITE_DESIGN_SETTING_KEY],
  );
  if (!row) return { settings: null, publishedAt: null };
  return {
    settings: (row.payload ?? null) as SiteDesignSettings | null,
    publishedAt: row.published_at ? (row.published_at instanceof Date ? row.published_at.toISOString() : String(row.published_at)) : null,
  };
}

async function writeAudit(entry: {
  actorId: string | null;
  action: string;
  entityId: string;
  metadata: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}) {
  await rows(
    `INSERT INTO audit_log (id, actor_id, actor_role, action, entity_type, entity_id, before, after, metadata, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      entry.actorId,
      "admin",
      entry.action,
      "site_design",
      entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      JSON.stringify(entry.metadata ?? {}),
      entry.requestId ?? null,
    ],
  );
}

/**
 * ذخیرهٔ پیش‌نویس. پیش‌نویس پیشین «آرشیو» می‌شود (نه حذف) تا تاریخچه کامل بماند
 * و در هر لحظه فقط یک پیش‌نویس فعال وجود داشته باشد.
 */
export async function saveSiteDesignDraft(
  settings: SiteDesignSettings,
  actor: { id: string | null; requestId?: string | null },
  note?: string | null,
) {
  const lockedColours = countLockedStrings(settings);
  const payload = validateSiteDesignSettings(settings);
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      "UPDATE site_design_revision SET status='archived' WHERE setting_key=$1 AND status='draft'",
      [SITE_DESIGN_SETTING_KEY],
    );
    await client.query(
      `INSERT INTO site_design_revision (id, setting_key, status, payload, note, created_by)
       VALUES ($1,$2,'draft',$3,$4,$5)`,
      [id, SITE_DESIGN_SETTING_KEY, JSON.stringify(payload), note ?? null, actor.id],
    );
  });
  await writeAudit({
    actorId: actor.id,
    action: "site_design.draft_saved",
    entityId: id,
    metadata: { sections: Object.keys(payload), note: note ?? null, lockedColours },
    requestId: actor.requestId,
  });
  return loadSiteDesignState();
}

/**
 * انتشار. اگر `revisionId` داده شود، همان نسخه منتشر می‌شود؛ در غیر این صورت
 * آخرین پیش‌نویس فعال منتشر می‌شود. نسخهٔ منتشرشدهٔ پیشین آرشیو می‌شود.
 */
export async function publishSiteDesign(actor: { id: string | null; requestId?: string | null }, revisionId?: string | null) {
  const source = revisionId
    ? (await rows<any>("SELECT * FROM site_design_revision WHERE id=$1 AND setting_key=$2 LIMIT 1", [revisionId, SITE_DESIGN_SETTING_KEY]))[0]
    : (await rows<any>("SELECT * FROM site_design_revision WHERE setting_key=$1 AND status='draft' ORDER BY created_at DESC LIMIT 1", [SITE_DESIGN_SETTING_KEY]))[0];
  if (!source) throw new HttpError(404, "SITE_DESIGN_DRAFT_NOT_FOUND", "پیش‌نویسی برای انتشار وجود ندارد.");

  const payload = validateSiteDesignSettings(source.payload ?? {});
  const [previous] = await rows<any>(
    "SELECT id FROM site_design_revision WHERE setting_key=$1 AND status='published' ORDER BY published_at DESC NULLS LAST LIMIT 1",
    [SITE_DESIGN_SETTING_KEY],
  );

  // پیش‌نویس با همان ردیف منتشر می‌شود (نه ردیف تکراری)؛ نسخهٔ آرشیوی که
  // دستی انتخاب شده باشد ردیف تازهٔ «منتشرشده» می‌سازد.
  const publishInPlace = source.status === "draft";
  const publishedId = publishInPlace ? String(source.id) : randomUUID();

  await transaction(async (client) => {
    await client.query(
      "UPDATE site_design_revision SET status='archived' WHERE setting_key=$1 AND status IN ('published','draft') AND id <> $2",
      [SITE_DESIGN_SETTING_KEY, publishInPlace ? source.id : ""],
    );
    if (publishInPlace) {
      await client.query(
        "UPDATE site_design_revision SET status='published', payload=$2, published_at=now() WHERE id=$1",
        [source.id, JSON.stringify(payload)],
      );
    } else {
      await client.query(
        `INSERT INTO site_design_revision (id, setting_key, status, payload, note, created_by, published_at)
         VALUES ($1,$2,'published',$3,$4,$5, now())`,
        [publishedId, SITE_DESIGN_SETTING_KEY, JSON.stringify(payload), source.note ?? null, actor.id],
      );
    }
    // سازگاری با مسیر قدیمی GET site/settings: نسخهٔ منتشرشده همان‌جا آینه می‌شود.
    await client.query(
      `INSERT INTO site_setting (setting_key, value, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (setting_key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
      [SITE_DESIGN_SETTING_KEY, JSON.stringify(payload), actor.id],
    );
  });

  await writeAudit({
    actorId: actor.id,
    action: "site_design.published",
    entityId: publishedId,
    metadata: { sourceRevisionId: source.id, sections: Object.keys(payload), inPlace: publishInPlace },
    before: previous ? { revisionId: previous.id } : undefined,
    after: { revisionId: publishedId },
    requestId: actor.requestId,
  });
  return loadSiteDesignState();
}

/** بازگردانی یک نسخهٔ قدیمی به‌صورت «پیش‌نویس تازه» (بدون انتشار خودکار). */
export async function restoreSiteDesignRevision(revisionId: string, actor: { id: string | null; requestId?: string | null }) {
  const revision = (await rows<any>("SELECT * FROM site_design_revision WHERE id=$1 AND setting_key=$2 LIMIT 1", [revisionId, SITE_DESIGN_SETTING_KEY]))[0];
  if (!revision) throw new HttpError(404, "SITE_DESIGN_REVISION_NOT_FOUND", "این نسخه پیدا نشد.");
  const state = await saveSiteDesignDraft(
    (revision.payload ?? {}) as SiteDesignSettings,
    actor,
    `بازگردانی نسخهٔ ${String(revision.id).slice(0, 8)}`,
  );
  await writeAudit({
    actorId: actor.id,
    action: "site_design.revision_restored",
    entityId: revisionId,
    metadata: { restoredFrom: revisionId },
    requestId: actor.requestId,
  });
  return state;
}
