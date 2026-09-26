import type { Metadata, Viewport } from "next";
import "./globals.css";
// فاز ۶.۱: نشانه‌های طراحی و لایهٔ پایهٔ RTL-safe. این دو فقط متغیر/کلاس اضافه
// می‌کنند و هیچ قانونِ موجودی را تغییر نمی‌دهند (بدون تغییر بصری).
import "../shared/design/tokens.css";
import "../shared/design/foundation.css";
import "../shared/design/components.css";

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
  const themeBootstrap = `(function(){try{var v=localStorage.getItem('kolbe-storefront-theme-v2');if(v!=='light'&&v!=='dark'&&v!=='system'){var old=localStorage.getItem('kolbe-storefront-theme-v1');v=old==='dark'?'dark':old==='liquid'?'light':'system'}var dark=v==='dark'||(v==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var t=dark?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.dataset.kolbeMode=t;document.documentElement.style.colorScheme=t}catch(e){}})();`;
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>{children}</body>
    </html>
  );
}
