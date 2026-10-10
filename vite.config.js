import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project site at /LoRa_mapping/, with the map app
// itself living under /map/ — the site root is the static landing page in
// landing/, assembled alongside this build by .github/workflows/deploy.yml.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/LoRa_mapping/map/' : '/',
  plugins: [react()],
})
