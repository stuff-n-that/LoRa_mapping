import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Repo is deployed as a GitHub Pages project site, so assets need the
// repo-name base path in production but plain '/' during local dev.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/LoRa_mapping/' : '/',
  plugins: [react()],
})
