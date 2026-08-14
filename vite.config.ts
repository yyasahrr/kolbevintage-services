import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set SINGLE_FILE=1 to produce the legacy inlined dist/index.html bundle.
const singleFile = process.env.SINGLE_FILE === "1";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(singleFile ? [viteSingleFile()] : [])],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    // allow the sandboxed preview host used during development
    allowedHosts: true,
  },
  build: singleFile
    ? {}
    : {
        rollupOptions: {
          output: {
            // keep the heavy chart library out of the initial page load
            manualChunks(id) {
              if (id.includes("node_modules/recharts") || id.includes("node_modules/d3")) return "charts";
              if (id.includes("node_modules/react")) return "react";
              return undefined;
            },
          },
        },
      },
});
