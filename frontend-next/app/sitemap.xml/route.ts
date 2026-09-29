import { originOf, publicSitemap } from "@server/commerce-discovery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const xml = await publicSitemap("index", originOf(req));
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
