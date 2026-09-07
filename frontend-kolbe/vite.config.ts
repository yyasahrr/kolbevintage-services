import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CORS کامل برای APIهای کلبه روی پروکسی dev:
 * - پیشنمایش مرورگر ممکن است در iframe با origin مبهم (null) اجرا شود؛
 *   preflightهای OPTIONS اینجا مستقیم پاسخ داده میشوند.
 * - هدر Origin از درخواست بالادستی حذف می‌شود.
 * - به پاسخهای پروکسیشده هدرهای ACAO اضافه میشود.
 */
const KOLBE_API_PATHS = ["/store/kolbe", "/admin/kolbe"];
const KOLBE_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "600",
};

/**
 * پنل ساپلایر روی همین سرور (/supplier.html):
 * مرورگر /frontend-supplier/src/main.tsx را میخواهد؛ به /@fs بازنویسی میشود
 * تا ماژولهای بیرون از root این پروژه سرو شوند.
 */
function kolbeSupplierEntryPlugin(): Plugin {
  const repoRoot = path.resolve(__dirname, "..");
  const rewrite = (req: any, _res: any, next: () => void) => {
    const url = req.url ?? "";
    if (url.startsWith("/frontend-supplier/")) {
      const [pathname, search = ""] = url.split("?");
      req.url = "/@fs" + path.join(repoRoot, pathname) + (search ? "?" + search : "");
    }
    next();
  };
  return {
    name: "kolbe-supplier-entry",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

function kolbeApiCorsPlugin(): Plugin {
  const middleware = (req: any, res: any, next: () => void) => {
    const url = req.url ?? "";
    if (!KOLBE_API_PATHS.some((p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?"))) {
      return next();
    }
    // حذف Origin تا بک‌اند درخواست را same-server ببیند
    delete req.headers.origin;
    delete req.headers.referer;
    if (req.method === "OPTIONS") {
      res.writeHead(204, KOLBE_CORS_HEADERS);
      res.end();
      return;
    }
    for (const [key, value] of Object.entries(KOLBE_CORS_HEADERS)) {
      if (key !== "access-control-max-age") res.setHeader(key, value);
    }
    next();
  };
  return {
    name: "kolbe-api-cors",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

const kolbeProxy = {
  target: "http://127.0.0.1:3000",
  changeOrigin: true,
  configure: (proxy: any) => {
    proxy.on("proxyReq", (proxyReq: any) => {
      proxyReq.removeHeader("origin");
      proxyReq.removeHeader("referer");
    });
    proxy.on("proxyRes", (proxyRes: any) => {
      proxyRes.headers["access-control-allow-origin"] = "*";
      proxyRes.headers["access-control-allow-headers"] = KOLBE_CORS_HEADERS["access-control-allow-headers"];
      proxyRes.headers["access-control-allow-methods"] = KOLBE_CORS_HEADERS["access-control-allow-methods"];
    });
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), kolbeSupplierEntryPlugin(), kolbeApiCorsPlugin()],
  // درخواست‌های API به اپ یکپارچه Next.js
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    // پنل ساپلایر از همین سرور روی /supplier.html سرو میشود
    fs: { allow: [path.resolve(__dirname, "..")] },
    proxy: {
      "/store/kolbe": kolbeProxy,
      "/admin/kolbe": kolbeProxy,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/store/kolbe": kolbeProxy,
      "/admin/kolbe": kolbeProxy,
    },
  },
});
