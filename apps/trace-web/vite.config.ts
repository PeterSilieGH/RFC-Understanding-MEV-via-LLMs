import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // dev-only; in compose, nginx proxies /api to trace-api instead
      "/api": {
        target: `http://localhost:${process.env.TRACE_API_PORT || 2021}`,
        changeOrigin: true,
      },
    },
  },
});
