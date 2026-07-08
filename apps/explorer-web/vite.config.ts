import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // dev-only; in compose, nginx proxies /api to explorer-api instead
      "/api": {
        target: `http://localhost:${process.env.EXPLORER_API_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
