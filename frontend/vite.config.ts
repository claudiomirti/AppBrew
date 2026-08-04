import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { kqlProxy } from './vite-kql-proxy.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), kqlProxy()],
  // Stamped into the bundle so the running build is identifiable at a glance — otherwise
  // there is no way to tell a fresh deployment from a cached one.
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, 'Z')),
  },
})
