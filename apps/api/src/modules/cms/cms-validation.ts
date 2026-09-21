import { ConflictError, ValidationError } from "@kolbe/shared";
import {
  CMS_DOCUMENT_TYPES,
  CMS_MEDIA_MIME_TYPES,
  CMS_PAGE_TYPES,
  CMS_REVISION_STATUSES,
  type KolbeDatabase,
} from "@kolbe/database";
export type { CmsPageType } from "@kolbe/database";
import type { CmsPageType } from "@kolbe/database";

/** Stable structured block keys consumed by the future storefront cutover. */
export const CMS_BLOCK_TYPES = [
  "HERO",
  "CATEGORY_GRID",
  "NEW_ARRIVALS",
  "BANNER",
  "BEST_SELLERS",
  "STYLE_LOOK",
  "TRUST",
  "EDITORIAL",
  "INSTAGRAM_EDITORIAL",
  "COUNTDOWN",
  "POPUP_REFERENCE",
  "CUSTOM_TEXT",
  "MEDIA",
  "CTA",
] as const;
export type CmsBlockType = (typeof CMS_BLOCK_TYPES)[number];

export type CmsBlock = {
  id: string;
  type: CmsBlockType;
  order: number;
  enabled: boolean;
  payload: Record<string, unknown>;
};

export type CmsSeoMetadata = {
  metaTitle?: string;
  metaDescription?: string;
  canonicalPath?: string;
  canonicalUrl?: string;
  robotsIndex?: boolean;
  robotsFollow?: boolean;
  openGraphTitle?: string;
  openGraphDescription?: string;
  openGraphMediaId?: string;
};

export const CMS_RESERVED_ROUTE_ROOTS = [
  "/api", "/admin", "/supplier", "/vip", "/store", "/_next", "/auth", "/checkout", "/account", "/cart",
  "/shop", "/collection", "/product", "/styles", "/try-on", "/wholesale", "/contact", "/login", "/register",
  "/health", "/docs",
] as const;

export const CMS_MEDIA_LIMITS = { imageBytes: 10 * 1024 * 1024, videoBytes: 25 * 1024 * 1024 } as const;

const BLOCK_PAYLOAD_KEYS: Record<CmsBlockType, readonly string[]> = {
  HERO: ["template", "bgImage", "mediaId", "mediaIds", "overlay", "imageShape", "dark", "videoIds", "eyebrow", "title", "subtitle", "description", "ctaLabel", "ctaTo", "primaryLabel", "primaryTo", "secondaryLabel", "secondaryTo", "titleColor", "subtitleColor", "countdown", "imageIds"],
  CATEGORY_GRID: ["title", "items", "categoryIds", "queryRef", "columns", "enabled"],
  NEW_ARRIVALS: ["title", "queryRef", "collectionKey", "limit", "catalogQuery", "enabled"],
  BANNER: ["mediaId", "mediaIds", "mediaType", "mediaUrl", "posterMediaId", "overlay", "height", "mode", "eyebrow", "title", "description", "buttonLabel", "buttonTo", "buttonBg", "buttonText", "tileMediaIds"],
  BEST_SELLERS: ["title", "queryRef", "collectionKey", "limit", "catalogQuery", "enabled"],
  STYLE_LOOK: ["mediaId", "title", "subtitle", "productReferences", "hotspots", "compact", "strategy", "enabled"],
  TRUST: ["title", "items", "enabled"],
  EDITORIAL: ["title", "articleKeys", "limit", "layout", "mediaId", "text", "enabled"],
  INSTAGRAM_EDITORIAL: ["enabled", "username", "cards", "cta", "mediaIds"],
  COUNTDOWN: ["enabled", "label", "target", "style", "accent", "bgColor", "bgMediaId", "size", "placement", "position", "align"],
  POPUP_REFERENCE: ["documentKey", "popupKey", "enabled"],
  CUSTOM_TEXT: ["heading", "text", "align", "tone", "enabled"],
  MEDIA: ["mediaId", "mediaIds", "altText", "caption", "fit", "linkTo", "enabled"],
  CTA: ["label", "to", "variant", "enabled"],
};

const BODY_BLOCK_KEYS: Record<string, readonly string[]> = {
  paragraph: ["type", "text"], heading: ["type", "level", "text"], image: ["type", "mediaId", "altText", "caption"],
  link: ["type", "label", "to"], list: ["type", "ordered", "items"], quote: ["type", "text", "attribution"],
};

const SEO_KEYS = ["metaTitle", "metaDescription", "canonicalPath", "canonicalUrl", "robotsIndex", "robotsFollow", "openGraphTitle", "openGraphDescription", "openGraphMediaId"] as const;
const DOCUMENT_KEYS: Record<string, readonly string[]> = {
  HOME_CONFIGURATION: ["mode", "template", "sections", "blocks", "campaignReference", "seo", "legacySettingKey", "legacyValue"],
  HEADER_CONFIGURATION: ["brand", "latinBrand", "shopLabel", "nav", "videoHeroTextColor", "backgroundColor", "textColor", "borderColor", "height", "sticky", "showNavigation", "showThemeToggle", "showSearch", "showAccount", "showWishlist", "legacySettingKey", "legacyValue"],
  FOOTER_CONFIGURATION: ["title", "description", "emailPlaceholder", "columns", "columnUrls", "address", "phone", "hours", "email", "copyright", "appearance", "newsletterEnabled", "socials", "legacySettingKey", "legacyValue"],
  HERO_CONFIGURATION: ["template", "hero", "heroStudio", "images", "mediaIds", "eyebrow", "title", "description", "primaryLabel", "primaryTo", "secondaryLabel", "secondaryTo", "countdown", "legacySettingKey", "legacyValue"],
  PROMOTIONAL_CONTENT_CONFIGURATION: ["banner", "popup", "look", "stylesSection", "instagram", "countdown", "editorial", "mediaIds", "legacySettingKey", "legacyValue"],
};

function invalid(fields: Array<{ field: string; code: string }>, message = "CMS content is invalid"): never {
  throw new ValidationError(fields, message);
}

function ensureObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid([{ field, code: "OBJECT_REQUIRED" }]);
  return value as Record<string, unknown>;
}

function ensureAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) invalid(unknown.map((key) => ({ field: `${field}.${key}`, code: "UNKNOWN_FIELD" })), "Unknown CMS fields are rejected");
}

/** Reject executable markup, script URLs, event attributes and prototype-pollution keys recursively. */
export function assertNoExecutableContent(value: unknown, field = "content"): void {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").toLowerCase();
    if (/<\s*script\b/.test(compact) || /<\s*\/\s*script\s*>/.test(compact) || /(?:java|vb)script\s*:/.test(compact) || /data\s*:\s*text\/html/.test(compact) || /\bon[a-z]+\s*=/.test(compact) || /(?:^|[^a-z])(?:eval|function)\s*\(/.test(compact) || /<\s*(?:iframe|object|embed|applet)\b/.test(compact)) {
      invalid([{ field, code: "EXECUTABLE_CONTENT_FORBIDDEN" }], "Executable HTML or JavaScript is not accepted");
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((entry, index) => assertNoExecutableContent(entry, `${field}[${index}]`)); return; }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(?:on[a-z]+|script|javascript|vbscript|eval|function|__proto__|constructor|prototype)$/i.test(key)) invalid([{ field: `${field}.${key}`, code: "EXECUTABLE_FIELD_FORBIDDEN" }]);
      assertNoExecutableContent(child, `${field}.${key}`);
    }
  }
}

export function normalizeRoutePath(input: unknown, field = "routePath"): string {
  if (typeof input !== "string" || input.length === 0) invalid([{ field, code: "ROUTE_REQUIRED" }]);
  let route: string;
  try { route = decodeURIComponent(input).normalize("NFKC").trim(); } catch { invalid([{ field, code: "ROUTE_ENCODING_INVALID" }]); }
  if (!route.startsWith("/") || route.includes("\\") || /(?:^|\/)\.\.?(?:\/|$)/.test(route) || /%2e|%2f|%5c/i.test(input)) invalid([{ field, code: "ROUTE_UNSAFE" }], "Path traversal is not allowed");
  if (/[?#\u0000-\u001f]/.test(route)) invalid([{ field, code: "ROUTE_INVALID_CHARACTERS" }]);
  route = route.replace(/\/{2,}/g, "/");
  if (route.length > 512) invalid([{ field, code: "ROUTE_TOO_LONG" }]);
  const lower = route.toLocaleLowerCase("en-US");
  const reserved = CMS_RESERVED_ROUTE_ROOTS.find((root) => lower === root || lower.startsWith(`${root}/`));
  if (reserved) throw new ConflictError("CMS_RESERVED_ROUTE", `Route ${route} is reserved by the application`);
  return route === "/" ? route : route.replace(/\/$/, "");
}

export function normalizeSlug(input: unknown, field = "slug"): string {
  if (typeof input !== "string" || input.trim() === "") invalid([{ field, code: "SLUG_REQUIRED" }]);
  let slug: string;
  try { slug = decodeURIComponent(input).normalize("NFKC").trim(); } catch { invalid([{ field, code: "SLUG_ENCODING_INVALID" }]); }
  if (slug === "." || slug === ".." || slug.includes("/") || slug.includes("\\") || /(?:^|[-_])\.\.(?:[-_]|$)/.test(slug) || /%2e|%2f|%5c/i.test(input) || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}_-]*$/u.test(slug) || slug.length > 180) invalid([{ field, code: "SLUG_UNSAFE" }], "Persian and ASCII slugs are allowed, but traversal is not");
  return slug.toLocaleLowerCase("en-US");
}

export function validateInternalOrExternalUrl(input: unknown, field: string, options: { allowEmpty?: boolean } = {}): string {
  if (input === undefined || input === null || input === "") { if (options.allowEmpty) return ""; invalid([{ field, code: "URL_REQUIRED" }]); }
  if (typeof input !== "string" || /[\u0000-\u001f\u007f]/.test(input)) invalid([{ field, code: "URL_INVALID" }]);
  const value = input.trim();
  if (value.startsWith("/")) {
    if (value.startsWith("//")) invalid([{ field, code: "URL_SCHEME_FORBIDDEN" }]);
    const hashOrQuery = value.search(/[?#]/);
    const pathnameInput = hashOrQuery < 0 ? value : value.slice(0, hashOrQuery);
    let pathname: string;
    try { pathname = decodeURIComponent(pathnameInput).normalize("NFKC").trim(); } catch { invalid([{ field, code: "URL_ENCODING_INVALID" }]); }
    if (!pathname.startsWith("/") || pathname.includes("\\") || /(?:^|\/)\.\.?(?:\/|$)/.test(pathname) || /%2e|%2f|%5c/i.test(pathnameInput)) invalid([{ field, code: "URL_UNSAFE" }]);
    const suffix = hashOrQuery < 0 ? "" : value.slice(hashOrQuery);
    if (/[\u0000-\u001f\u007f]/.test(suffix) || /(?:java|vb)script\s*:/i.test(suffix)) invalid([{ field, code: "URL_INVALID" }]);
    const normalizedPath = pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return normalizedPath + suffix;
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { invalid([{ field, code: "URL_INVALID" }]); }
  if (!/^https?:$/i.test(parsed.protocol) || parsed.username || parsed.password) invalid([{ field, code: "URL_SCHEME_FORBIDDEN" }], "Only safe HTTP(S) URLs are allowed");
  return parsed.toString();
}

export function validateBlocks(input: unknown, field = "blocks"): CmsBlock[] {
  if (!Array.isArray(input)) invalid([{ field, code: "ARRAY_REQUIRED" }]);
  if (input.length > 100) invalid([{ field, code: "TOO_MANY_BLOCKS" }]);
  const known = new Set<string>(CMS_BLOCK_TYPES); const ids = new Set<string>();
  return input.map((raw, index) => {
    const value = ensureObject(raw, `${field}[${index}]`);
    const type = typeof value.type === "string" ? value.type.toUpperCase() : "";
    if (!known.has(type)) invalid([{ field: `${field}[${index}].type`, code: "UNKNOWN_BLOCK_TYPE" }]);
    const payload = ensureObject(value.payload ?? {}, `${field}[${index}].payload`);
    ensureAllowedKeys(payload, BLOCK_PAYLOAD_KEYS[type as CmsBlockType], `${field}[${index}].payload`);
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : `block-${index + 1}`;
    if (!/^[\w\-:.]{1,120}$/u.test(id) || ids.has(id)) invalid([{ field: `${field}[${index}].id`, code: "BLOCK_ID_INVALID" }]);
    ids.add(id);
    const order = value.order === undefined ? index : Number(value.order);
    if (!Number.isInteger(order) || order < 0 || order > 10000) invalid([{ field: `${field}[${index}].order`, code: "ORDER_INVALID" }]);
    const enabled = value.enabled === undefined ? true : value.enabled;
    if (typeof enabled !== "boolean") invalid([{ field: `${field}[${index}].enabled`, code: "BOOLEAN_REQUIRED" }]);
    if (type === "CTA" && payload.to !== undefined) payload.to = validateInternalOrExternalUrl(payload.to, `${field}[${index}].payload.to`);
    if (type === "HERO" && payload.ctaTo !== undefined) payload.ctaTo = validateInternalOrExternalUrl(payload.ctaTo, `${field}[${index}].payload.ctaTo`);
    if (type === "HERO" && payload.primaryTo !== undefined) payload.primaryTo = validateInternalOrExternalUrl(payload.primaryTo, `${field}[${index}].payload.primaryTo`);
    if (type === "HERO" && payload.secondaryTo !== undefined) payload.secondaryTo = validateInternalOrExternalUrl(payload.secondaryTo, `${field}[${index}].payload.secondaryTo`);
    if (type === "BANNER" && payload.buttonTo !== undefined) payload.buttonTo = validateInternalOrExternalUrl(payload.buttonTo, `${field}[${index}].payload.buttonTo`);
    if (type === "MEDIA" && payload.linkTo !== undefined) payload.linkTo = validateInternalOrExternalUrl(payload.linkTo, `${field}[${index}].payload.linkTo`);
    assertNoExecutableContent(payload, `${field}[${index}].payload`);
    return { id, type: type as CmsBlockType, order, enabled, payload };
  }).sort((a, b) => a.order - b.order);
}

export function validateRichBody(input: unknown, field = "structuredBody"): unknown[] {
  if (!Array.isArray(input)) invalid([{ field, code: "STRUCTURED_BODY_REQUIRED" }]);
  if (input.length > 500) invalid([{ field, code: "TOO_MANY_BODY_BLOCKS" }]);
  return input.map((raw, index) => {
    const value = ensureObject(raw, `${field}[${index}]`); const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
    if (!BODY_BLOCK_KEYS[type]) invalid([{ field: `${field}[${index}].type`, code: "RICH_BLOCK_TYPE_FORBIDDEN" }]);
    ensureAllowedKeys(value, BODY_BLOCK_KEYS[type], `${field}[${index}]`);
    if (type === "link") value.to = validateInternalOrExternalUrl(value.to, `${field}[${index}].to`);
    if (type === "heading" && (!Number.isInteger(Number(value.level)) || Number(value.level) < 2 || Number(value.level) > 4)) invalid([{ field: `${field}[${index}].level`, code: "HEADING_LEVEL_INVALID" }]);
    assertNoExecutableContent(value, `${field}[${index}]`); return value;
  });
}

export function validateSeo(input: unknown, field = "seoMetadata"): CmsSeoMetadata {
  const value = ensureObject(input ?? {}, field); ensureAllowedKeys(value, SEO_KEYS, field); const out: CmsSeoMetadata = {};
  for (const key of SEO_KEYS) {
    if (value[key] === undefined) continue;
    if (["robotsIndex", "robotsFollow"].includes(key)) { if (typeof value[key] !== "boolean") invalid([{ field: `${field}.${key}`, code: "BOOLEAN_REQUIRED" }]); (out as Record<string, unknown>)[key] = value[key]; continue; }
    if (typeof value[key] !== "string" || value[key].length > (key === "metaDescription" || key === "openGraphDescription" ? 320 : 180)) invalid([{ field: `${field}.${key}`, code: "SEO_TEXT_INVALID" }]);
    if (key === "canonicalPath") (out as Record<string, unknown>)[key] = normalizeRoutePath(value[key], `${field}.${key}`);
    else if (key === "canonicalUrl") (out as Record<string, unknown>)[key] = validateInternalOrExternalUrl(value[key], `${field}.${key}`);
    else (out as Record<string, unknown>)[key] = value[key];
  }
  assertNoExecutableContent(out, field); return out;
}

export function validatePageType(input: unknown): CmsPageType {
  if (typeof input !== "string" || !(CMS_PAGE_TYPES as readonly string[]).includes(input)) invalid([{ field: "pageType", code: "PAGE_TYPE_INVALID" }]);
  return input as CmsPageType;
}

export function validateRevisionStatusTransition(from: string, to: string): void {
  if (!(CMS_REVISION_STATUSES as readonly string[]).includes(to)) invalid([{ field: "status", code: "REVISION_STATUS_INVALID" }]);
  const transitions: Record<string, readonly string[]> = { DRAFT: ["IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"], IN_REVIEW: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"], SCHEDULED: ["DRAFT", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["SUPERSEDED", "ARCHIVED"], SUPERSEDED: ["ARCHIVED"], ARCHIVED: [] };
  if (!transitions[from]?.includes(to)) throw new ConflictError("CMS_INVALID_REVISION_TRANSITION", `Cannot transition ${from} to ${to}`);
}

export function validateDocumentType(input: unknown): (typeof CMS_DOCUMENT_TYPES)[number] {
  if (typeof input !== "string" || !(CMS_DOCUMENT_TYPES as readonly string[]).includes(input)) invalid([{ field: "documentType", code: "DOCUMENT_TYPE_INVALID" }]);
  return input as (typeof CMS_DOCUMENT_TYPES)[number];
}

export function validateDocumentPayload(documentType: string, input: unknown): Record<string, unknown> {
  const value = ensureObject(input, "payload"); const allowed = DOCUMENT_KEYS[documentType];
  if (!allowed) invalid([{ field: "documentType", code: "DOCUMENT_TYPE_INVALID" }]);
  ensureAllowedKeys(value, allowed, "payload");
  if (value.sections !== undefined && !Array.isArray(value.sections)) invalid([{ field: "payload.sections", code: "ARRAY_REQUIRED" }]);
  if (value.blocks !== undefined) value.blocks = validateBlocks(value.blocks, "payload.blocks");
  assertNoExecutableContent(value, "payload"); return value;
}

export function validateMimeType(input: unknown): (typeof CMS_MEDIA_MIME_TYPES)[number] {
  if (typeof input !== "string" || !(CMS_MEDIA_MIME_TYPES as readonly string[]).includes(input.toLowerCase())) invalid([{ field: "mimeType", code: "MIME_TYPE_UNSUPPORTED" }]);
  return input.toLowerCase() as (typeof CMS_MEDIA_MIME_TYPES)[number];
}

export function ensureIanaTimezone(value: unknown): string {
  if (typeof value !== "string" || value.length > 80) invalid([{ field: "timezone", code: "TIMEZONE_INVALID" }]);
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); } catch { invalid([{ field: "timezone", code: "TIMEZONE_INVALID" }]); }
  return value;
}

export function ensureUtcDate(value: unknown, field: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") invalid([{ field, code: "TIMESTAMP_INVALID" }]);
  const date = new Date(value); if (Number.isNaN(date.getTime())) invalid([{ field, code: "TIMESTAMP_INVALID" }]); return date;
}

export function validateSchedule(publishAtInput: unknown, unpublishAtInput?: unknown): { publishAt: Date; unpublishAt: Date | null } {
  const publishAt = ensureUtcDate(publishAtInput, "publishAt");
  const unpublishAt = unpublishAtInput === undefined || unpublishAtInput === null || unpublishAtInput === "" ? null : ensureUtcDate(unpublishAtInput, "unpublishAt");
  if (publishAt.getTime() <= Date.now() - 60_000) invalid([{ field: "publishAt", code: "SCHEDULE_MUST_BE_FUTURE" }]);
  if (unpublishAt && unpublishAt.getTime() <= publishAt.getTime()) invalid([{ field: "unpublishAt", code: "UNPUBLISH_MUST_FOLLOW_PUBLISH" }]);
  return { publishAt, unpublishAt };
}

export function collectMediaReferences(value: unknown, path = "content"): Array<{ id: string; path: string }> {
  const found: Array<{ id: string; path: string }> = [];
  const walk = (entry: unknown, currentPath: string) => {
    if (Array.isArray(entry)) { entry.forEach((child, index) => walk(child, `${currentPath}[${index}]`)); return; }
    if (!entry || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      if ((key === "mediaId" || key === "coverMediaId" || key === "openGraphMediaId" || key === "posterMediaId" || key === "bgMediaId") && typeof child === "string" && child) found.push({ id: child, path: `${currentPath}.${key}` });
      if (key === "mediaIds" && Array.isArray(child)) child.forEach((id, index) => { if (typeof id === "string") found.push({ id, path: `${currentPath}.mediaIds[${index}]` }); });
      walk(child, `${currentPath}.${key}`);
    }
  };
  walk(value, path); return found;
}

export function makeCmsId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`; }
export function assertUniqueRouteSafety(route: string): string { return normalizeRoutePath(route); }

export type CmsNavigationItem = { id: string; label: string; href?: string; children?: CmsNavigationItem[]; enabled: boolean };

export function validateNavigationItems(input: unknown, field = "items"): CmsNavigationItem[] {
  if (!Array.isArray(input)) invalid([{ field, code: "ARRAY_REQUIRED" }]);
  if (input.length > 100) invalid([{ field, code: "TOO_MANY_NAVIGATION_ITEMS" }]);
  const ids = new Set<string>();
  const walk = (raw: unknown, path: string, depth: number): CmsNavigationItem => {
    if (depth > 3) invalid([{ field: path, code: "NAVIGATION_DEPTH_EXCEEDED" }]);
    const value = ensureObject(raw, path); ensureAllowedKeys(value, ["id", "label", "href", "children", "enabled"], path);
    const id = typeof value.id === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(value.id) ? value.id : "";
    if (!id || ids.has(id)) invalid([{ field: `${path}.id`, code: "NAVIGATION_ID_INVALID" }]); ids.add(id);
    if (typeof value.label !== "string" || !value.label.trim() || value.label.length > 200) invalid([{ field: `${path}.label`, code: "LABEL_INVALID" }]);
    const enabled = value.enabled === undefined ? true : value.enabled; if (typeof enabled !== "boolean") invalid([{ field: `${path}.enabled`, code: "BOOLEAN_REQUIRED" }]);
    let href: string | undefined; if (value.href !== undefined) href = validateInternalOrExternalUrl(value.href, `${path}.href`);
    const children = value.children === undefined ? undefined : (() => { if (!Array.isArray(value.children)) invalid([{ field: `${path}.children`, code: "ARRAY_REQUIRED" }]); if (value.children.length > 50) invalid([{ field: `${path}.children`, code: "TOO_MANY_NAVIGATION_ITEMS" }]); return value.children.map((child, index) => walk(child, `${path}.children[${index}]`, depth + 1)); })();
    if (!href && !children?.length) invalid([{ field: `${path}.href`, code: "NAVIGATION_TARGET_REQUIRED" }]);
    assertNoExecutableContent({ label: value.label, href, children }, path); return { id, label: value.label.normalize("NFKC").trim(), href, children, enabled };
  };
  return input.map((item, index) => walk(item, `${field}[${index}]`, 0));
}

export type CmsDbExecutor = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
