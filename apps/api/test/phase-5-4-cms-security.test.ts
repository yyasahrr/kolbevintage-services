import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  CMS_BLOCK_TYPES,
  assertNoExecutableContent,
  normalizeRoutePath,
  normalizeSlug,
  validateBlocks,
  validateInternalOrExternalUrl,
  validateNavigationItems,
  validateRichBody,
  validateSeo,
} from "../src/modules/cms/cms-validation";
import { detectMediaSignature, LocalPublicMediaStorage } from "../src/modules/cms/public-media-storage";
import { CmsPreviewService } from "../src/modules/cms/cms-preview.service";

const tempRoots: string[] = [];
afterEach(async () => { await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Phase 5.4 CMS adversarial validation", () => {
  it("normalizes Persian routes/slugs and rejects traversal, reserved identity routes, and encoded separators", () => {
    expect(normalizeRoutePath("/درباره/کلبه")).toBe("/درباره/کلبه");
    expect(normalizeSlug("خانه-وینتیج")).toBe("خانه-وینتیج");
    expect(() => normalizeRoutePath("/../secret")).toThrow();
    expect(() => normalizeRoutePath("/%2e%2e/secret")).toThrow();
    expect(() => normalizeRoutePath("/api/cms")).toThrow();
    expect(() => normalizeSlug("foo/bar")).toThrow();
    expect(() => normalizeSlug("foo%2fbar")).toThrow();
  });

  it("accepts every required block type but rejects unknown fields and executable payloads", () => {
    const blocks = validateBlocks(CMS_BLOCK_TYPES.map((type, index) => ({ id: `b-${index}`, type, order: index, enabled: true, payload: {} })));
    expect(blocks).toHaveLength(CMS_BLOCK_TYPES.length);
    expect(() => validateBlocks([{ type: "HERO", payload: { notARealField: true } }])).toThrow();
    expect(() => validateBlocks([{ type: "CUSTOM_TEXT", payload: { text: "<script>alert(1)</script>" } }])).toThrow();
    expect(() => assertNoExecutableContent({ html: "<img src=x onerror=alert(1)>" })).toThrow();
  });

  it("allows safe internal query links and HTTPS links while rejecting executable schemes and protocol-relative hosts", () => {
    expect(validateInternalOrExternalUrl("/shop?sort=new", "to")).toBe("/shop?sort=new");
    expect(validateInternalOrExternalUrl("https://example.com/lookbook", "to")).toBe("https://example.com/lookbook");
    expect(() => validateInternalOrExternalUrl("javascript:alert(1)", "to")).toThrow();
    expect(() => validateInternalOrExternalUrl("//evil.example/path", "to")).toThrow();
    expect(() => validateInternalOrExternalUrl("/x/%2f../secret", "to")).toThrow();
  });

  it("bounds navigation nesting and rejects executable URLs", () => {
    expect(validateNavigationItems([{ id: "root", label: "ریشه", children: [{ id: "child", label: "فرزند", href: "/shop" }] }])).toHaveLength(1);
    expect(() => validateNavigationItems([{ id: "root", label: "ریشه", href: "javascript:alert(1)" }])).toThrow();
    expect(() => validateNavigationItems([{ id: "root", label: "ریشه", children: [{ id: "child", label: "فرزند", children: [{ id: "grand", label: "نوه", children: [{ id: "deep", label: "عمق", children: [{ id: "too-deep", label: "خیلی عمیق", href: "/safe" }] }] }] }] }])).toThrow();
  });

  it("allows only structured rich text and script-free SEO", () => {
    expect(validateRichBody([{ type: "paragraph", text: "متن فارسی" }, { type: "link", label: "خانه", to: "/" }])).toHaveLength(2);
    expect(() => validateRichBody([{ type: "html", value: "<p>bad</p>" }])).toThrow();
    expect(validateSeo({ metaTitle: "کلبه", canonicalPath: "/درباره" }).canonicalPath).toBe("/درباره");
    expect(() => validateSeo({ metaTitle: "<script>x</script>" })).toThrow();
  });

  it("checks media magic bytes and confines the implemented local public provider", async () => {
    expect(detectMediaSignature(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectMediaSignature(Buffer.from("not-an-image"))).toBeNull();
    const root = await mkdtemp(join(tmpdir(), "kolbe-cms-media-"));
    tempRoots.push(root);
    process.env.CMS_PUBLIC_MEDIA_DIR = root;
    const storage = new LocalPublicMediaStorage();
    const object = await storage.put({ objectKey: "cms/media_test.jpg", bytes: Buffer.from("bytes"), mimeType: "image/jpeg" });
    expect(object.publicUrl).toContain("/cms/public/media/media_test/file");
    await expect(storage.read("../escape")).rejects.toThrow();
    await storage.remove(object.objectKey);
  });

  it("issues expiring, target-bound preview capabilities", () => {
    const preview = new CmsPreviewService({ sessionSecret: "a".repeat(40) } as any);
    const token = preview.issue("PAGE_REVISION", "page_rev_abc", 60);
    expect(preview.verify(token, "PAGE_REVISION", "page_rev_abc")).toBe(true);
    expect(preview.verify(token, "PAGE_REVISION", "page_rev_other")).toBe(false);
    expect(preview.verify(token, "CONTENT_REVISION", "page_rev_abc")).toBe(false);
    expect(preview.verify(`${token}tampered`, "PAGE_REVISION", "page_rev_abc")).toBe(false);
  });
});
