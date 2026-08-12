import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const UNDERWRITER = process.env.UNDERWRITER_URL ?? "http://localhost:3003";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      // SSE needs the proxy too, so the browser sees one origin.
      "/api": { target: UNDERWRITER, changeOrigin: true },
    },
  },
});
