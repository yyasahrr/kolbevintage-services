import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { organizationJsonLd } from "@server/seo-discovery";
import "./globals.css";

export const metadata: Metadata = {
  title: "کلبه وینتیج | پوشاک کلاسیک، وینتیج و دست‌دوز",
  description:
    "کلبه وینتیج — پوشاک کلاسیک و وینتیج با دوخت دست. استایل‌های Old Money، Vintage، Dark Academia، Minimal و Neo Classic.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#011c3a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "";
  const proto = headerList.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : "";
  const organization = await organizationJsonLd(origin).catch(() => null);
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        {organization && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replaceAll("<", "\\u003c") }} />
        )}
        {children}
      </body>
    </html>
  );
}
