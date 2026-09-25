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
    target: 'es2017',
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
  plugins: [{
    name: 'sw-build-version',
    // Build-only: stamping a fresh Date.now() on every dev-server request
    // gives each page load a different SW_BUILD, so /sw.js?v=<fresh>
    // installs a "new" worker on every load -> controllerchange ->
    // location.reload() -> infinite F5 loop in `npm run dev`.
    // Production builds still get one fresh stamp per build (one reload
    // per deploy, as intended).
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('/*__SW_BUILD__*/ 1', '/*__SW_BUILD__*/ ' + Date.now());
    }
  }],
})

