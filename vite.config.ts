import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Keep packaged applications and QA runtime caches out of development watching.
      ignored: ['**/release/**'],
    },
  },
})
