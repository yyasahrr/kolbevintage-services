import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // درخواستهای API بک‌اند مدوسا (پروکسی سرور->سرور؛ مرورگر هرگز localhost صدا نمیزند)
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/store/kolbe": { target: "http://127.0.0.1:9000", changeOrigin: true },
      "/admin/kolbe": { target: "http://127.0.0.1:9000", changeOrigin: true },
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
      "/store/kolbe": { target: "http://127.0.0.1:9000", changeOrigin: true },
      "/admin/kolbe": { target: "http://127.0.0.1:9000", changeOrigin: true },
    },
  },
});
