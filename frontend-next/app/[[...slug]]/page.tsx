"use client";

/**
 * فروشگاه کلبه — همه مسیرها از این صفحه سرو می‌شوند.
 * اپ SPA با روتر هش‌محور خودش است (مثل نسخه Vite) و کاملاً سمت کلاینت رندر
 * می‌شود چون به window/localStorage وابسته است.
 */

import dynamic from "next/dynamic";
import { applyStorefrontTheme, readStorefrontTheme } from "@/theme";

// اعمال تم ذخیرهشده قبل از رندر (فقط در مرورگر)
if (typeof document !== "undefined") {
  applyStorefrontTheme(readStorefrontTheme());
}

const StorefrontApp = dynamic(() => import("@/App"), {
  ssr: false,
  loading: () => <BootScreen />,
});

function BootScreen() {
  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "#f7f5f0",
        color: "#011c3a",
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "2px solid rgba(1,28,58,0.15)",
          borderTopColor: "#011c3a",
          animation: "kolbe-boot-spin 0.8s linear infinite",
        }}
      />
      <p style={{ fontSize: 12, letterSpacing: "0.2em", opacity: 0.55 }}>KOLBE VINTAGE</p>
      <style>{`@keyframes kolbe-boot-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function StorefrontPage() {
  return <StorefrontApp />;
}
