import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this as a project site under /LoRa_mapping/, so
// production assets need that base path. The local server (see server/) is
// served from the root of its own port instead, same as dev — its build
// sets VITE_LIVE_PROXY=true, which doubles as the signal to use '/' here.
const isLocalServerBuild = process.env.VITE_LIVE_PROXY === 'true'
export default defineConfig({
  base: process.env.NODE_ENV === 'production' && !isLocalServerBuild ? '/LoRa_mapping/' : '/',
  plugins: [react()],
})
