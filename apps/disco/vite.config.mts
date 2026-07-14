import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// Diverges from upstream: no OpenPanel analytics plugin, @l2beat/* resolved
// to src/vendor (ADR-004), and /api/traces routed to our trace-api while the
// rest of /api goes to the DiscoUI backend (l2b ui).
// biome-ignore lint/style/noDefaultExport: Vite requires default export
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@l2beat/validate': path.resolve(__dirname, 'src/vendor/validate/index.ts'),
      '@l2beat/shared-pure': path.resolve(__dirname, 'src/vendor/shared-pure/index.ts'),
      '@l2beat/discovery': path.resolve(__dirname, 'src/vendor/discovery/index.ts'),
    },
  },
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor')) {
            return 'monaco'
          }
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/traces': {
        target: `http://localhost:${process.env.TRACE_API_PORT || 2022}/`,
        changeOrigin: true,
      },
      '/api/contracts': {
        target: `http://localhost:${process.env.TRACE_API_PORT || 2022}/`,
        changeOrigin: true,
      },
      '/api/mev': {
        target: `http://localhost:${process.env.EXPLORER_API_PORT || 3000}/`,
        changeOrigin: true,
      },
      '/api': {
        target: `http://localhost:${process.env.DISCO_API_PORT || 2021}/`,
        changeOrigin: true,
        timeout: 99999999,
      },
    },
  },
})
