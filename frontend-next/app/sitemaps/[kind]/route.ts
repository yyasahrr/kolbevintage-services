import { originOf, publicSitemap } from "@server/commerce-discovery";

export const dynamic = "force-dynamic";

const KINDS = new Set(["products", "categories", "pages", "blog", "images"]);

type Ctx = { params: Promise<{ kind: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { kind } = await ctx.params;
  const name = kind.replace(/\.xml$/, "");
  if (!KINDS.has(name)) return new Response("not found", { status: 404 });
  const xml = await publicSitemap(name as "products", originOf(req));
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
