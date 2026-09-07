import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
