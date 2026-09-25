"use client";

/**
 * پورتال ساپلایر — اپ مستقل با استایلهای اختصاصی خودش.
 * CSS پنل فقط هنگام باز بودن همین صفحه تزریق می‌شود تا با فروشگاه تداخل نکند
 * و با خروج از پنل حذف می‌شود.
 */

import dynamic from "next/dynamic";
import { useEffect } from "react";

const SupplierApp = dynamic(() => import("../../supplier-src/App"), {
  ssr: false,
  loading: () => (
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
        color: "#071c31",
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "2px solid rgba(7,28,49,0.15)",
          borderTopColor: "#071c31",
          animation: "kolbe-boot-spin 0.8s linear infinite",
        }}
      />
      <p style={{ fontSize: 12, letterSpacing: "0.2em", opacity: 0.55 }}>SUPPLIER PORTAL</p>
      <style>{`@keyframes kolbe-boot-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ),
});

export default function SupplierPage() {
  useEffect(() => {
    const links = ["styles.css", "auth.css", "workflows.css", "design-system.css", "portal.css"].map((file) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/supplier-portal/${file}`;
      link.dataset.kolbeSupplier = "true";
      document.head.appendChild(link);
      return link;
    });
    document.title = "Kolbe Vintage — Supplier Portal";
    return () => {
      links.forEach((link) => link.remove());
    };
  }, []);

  return <SupplierApp />;
}
