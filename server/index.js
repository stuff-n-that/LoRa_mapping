#!/usr/bin/env node
// Minimal local server for self-hosting LoRa Mesh Map: serves the built
// frontend and proxies MeshCore/Meshtastic live data server-side, so the
// browser never talks to those APIs directly and never hits CORS.
//
// Usage:
//   npm run build:server   # bakes VITE_LIVE_PROXY=true into the frontend
//   npm run server         # then serve it
// or just: npm start

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchMeshcoreNodes } from '../src/api/meshcoreLive.js'
import { fetchMeshtasticNodes } from '../src/api/meshtasticLive.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR = resolve(__dirname, '../dist')
const PORT = process.env.PORT ? Number(process.env.PORT) : 5175
const CACHE_TTL_MS = 5 * 60 * 1000

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const FETCHERS = {
  meshcore: fetchMeshcoreNodes,
  meshtastic: fetchMeshtasticNodes,
}

const caches = {
  meshcore: { nodes: [], updatedAt: null, error: null, fetching: null },
  meshtastic: { nodes: [], updatedAt: null, error: null, fetching: null },
}

// Lazy refresh, not a background timer: only fetches upstream when a
// request actually arrives and the cache is stale, so an idle server does
// no work. Serves the last-known nodes alongside any new error rather than
// wiping the map on a transient upstream failure.
async function getLiveNodes(source) {
  const cache = caches[source]
  const isStale = !cache.updatedAt || Date.now() - cache.updatedAt > CACHE_TTL_MS

  if (isStale && !cache.fetching) {
    cache.fetching = FETCHERS[source]()
      .then((nodes) => {
        cache.nodes = nodes
        cache.updatedAt = Date.now()
        cache.error = null
      })
      .catch((err) => {
        cache.error = err.message
      })
      .finally(() => {
        cache.fetching = null
      })
  }

  if (isStale && cache.fetching) await cache.fetching

  return cache
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0])
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(DIST_DIR, safePath)

  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    filePath = join(DIST_DIR, 'index.html') // SPA fallback (also covers 404s)
  }

  try {
    const content = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = createServer(async (req, res) => {
  const match = req.url.match(/^\/api\/live-nodes\/(meshcore|meshtastic)(?:\?|$)/)
  if (match) {
    const source = match[1]
    const cache = await getLiveNodes(source)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ nodes: cache.nodes, updatedAt: cache.updatedAt, error: cache.error }))
    return
  }

  await serveStatic(req, res)
})

server.listen(PORT, () => {
  console.log(`LoRa Mesh Map running at http://localhost:${PORT}`)
  console.log(`Serving from ${DIST_DIR} — run "npm run build:server" first if this is stale or missing.`)
})
