import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    hmr: {
      host: 'localhost',
    },
  },
  preview: {
    port: 5173,
  },
  build: {
    target: 'esnext', // Support top-level await
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('exceljs')) return 'vendor-exceljs';
            return 'vendor';
          }
        }
      }
    }
  },
})

