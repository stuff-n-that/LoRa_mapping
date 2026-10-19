import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

const here = path.dirname(fileURLToPath(import.meta.url))

// In dev the planner reads node data from where the map app's deploy publishes
// it (/map/regions/). Serve a local copy at that URL if there is one:
// the default is ../public/regions (what `npm run pull-live-nodes public/regions`
// writes); set REGIONS_DIR to use another folder.
function serveRegions(): Plugin {
  const dir = path.resolve(here, process.env.REGIONS_DIR ?? '../public/regions')
  return {
    name: 'serve-regions',
    configureServer(server) {
      server.middlewares.use('/map/regions', (req, res, next) => {
        const name = path.basename((req.url ?? '').split('?')[0])
        const file = path.join(dir, name)
        if (!/^[A-Za-z]+\.json$/.test(name) || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/json')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

// GitHub Pages serves the project at /LoRa_mapping/; the planner lives under
// /plan/ (assembled by .github/workflows/deploy.yml).
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/LoRa_mapping/plan/' : '/',
  plugins: [react(), serveRegions()],
  resolve: {
    // Pure modules shared with the main map app (e.g. the role categories).
    alias: { '@shared': path.resolve(here, '../src/utils') },
  },
  server: { fs: { allow: ['..'] } },
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
