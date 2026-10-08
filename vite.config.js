import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this as a project site under /LoRa_mapping/, so
// production assets need that base path.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/LoRa_mapping/' : '/',
  plugins: [react()],
})
