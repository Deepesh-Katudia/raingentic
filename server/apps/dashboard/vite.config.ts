import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const UNDERWRITER = process.env.UNDERWRITER_URL ?? "http://localhost:3003";
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // SSE needs the proxy too, so the browser sees one origin.
      "/api": { target: UNDERWRITER, changeOrigin: true },
    },
  },
});
