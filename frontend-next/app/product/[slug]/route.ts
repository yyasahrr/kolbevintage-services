import { originOf, publicProductHtml } from "@server/commerce-discovery";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const origin = originOf(req);
  const result = await publicProductHtml(decodeURIComponent(slug), origin, url.searchParams, req.headers.get("referer"));
  if (result.kind === "redirect") {
    if (result.status === 410) {
      return new Response("<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta name=\"robots\" content=\"noindex\"><title>حذف شده</title></head><body><h1>این نشانی دیگر موجود نیست</h1></body></html>", {
        status: 410,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(null, { status: result.status, headers: { location: result.target || "/" } });
  }
  if (result.kind === "missing") {
    return new Response("<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta name=\"robots\" content=\"noindex\"><title>پیدا نشد</title></head><body><h1>صفحه پیدا نشد</h1></body></html>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(result.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
