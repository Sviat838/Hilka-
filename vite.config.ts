/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped onto every analytics event as `app_version` so behaviour can be split
// by release. `npm run build`/`dev` set npm_package_version; fall back for a bare
// `vite` invocation.
const appVersion = process.env.npm_package_version ?? 'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    rollupOptions: {
      output: {
        // Split the stable vendor libs into their own long-cached chunk so an
        // app-code edit doesn't re-bust them on every push-to-main deploy.
        manualChunks: {
          vendor: ['react', 'react-dom', '@tanstack/react-query', '@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
