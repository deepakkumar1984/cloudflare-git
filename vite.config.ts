import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Playwright starts a second dev server; give it its own dependency
  // optimizer cache so it cannot clash with an active `npm run dev`.
  ...(process.env.VITE_E2E === "1"
    ? { cacheDir: "node_modules/.vite-e2e" }
    : {}),
  plugins: [react(), cloudflare(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
      "@db": fileURLToPath(new URL("./src/db", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
