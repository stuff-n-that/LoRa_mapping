#!/usr/bin/env node
// Fetches current node data from the MeshCore and Meshtastic public APIs and
// writes it to a JSON file. Two uses:
//   1. Load it into the map yourself via the "Import" button.
//   2. Run as part of the GitHub Pages build (see .github/workflows/deploy.yml)
//      to embed a periodically-refreshed snapshot as a static file the
//      frontend loads automatically on startup.
//
// Runs server-side (Node, not a browser) so it isn't subject to the CORS
// restrictions that block these same fetches from the deployed GitHub Pages
// site — see README.md's "Live data feeds" section for why.
//
// Usage: node scripts/pull-live-nodes.mjs [output-path]

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fetchMeshcoreNodes } from '../src/api/meshcoreLive.js'
import { fetchMeshtasticNodes } from '../src/api/meshtasticLive.js'

const outPath = process.argv[2] || 'live-nodes-snapshot.json'

// Pure safety backstop against a pathological upstream response (not a
// realistic limiter under normal conditions) — real counts as of
// 2026-09-22 were 25,034 MeshCore + 17,980 Meshtastic active nodes, both
// comfortably under this. A LOWER cap was tried first (5,000/network) and
// had to be reverted: sorting "most recent globally" before slicing is
// geographically blind, so it silently gutted whole dense regions (e.g.
// Northern Europe) that just happened to have slightly older timestamps
// than nodes elsewhere — confirmed by comparing against meshcore.co.uk's
// own map for the same area. Prefer widening ACTIVE_WINDOW_MS in
// activeNode.js over lowering this if the payload ever needs trimming
// again; it doesn't have this bias.
const MAX_NODES_PER_NETWORK = 30000

function capToMostRecent(nodes, max) {
  if (nodes.length <= max) return nodes
  return [...nodes].sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0)).slice(0, max)
}

async function main() {
  const [meshcoreResult, meshtasticResult] = await Promise.allSettled([
    fetchMeshcoreNodes(),
    fetchMeshtasticNodes(),
  ])

  const nodes = []

  if (meshcoreResult.status === 'fulfilled') {
    const capped = capToMostRecent(meshcoreResult.value, MAX_NODES_PER_NETWORK)
    nodes.push(...capped)
    console.log(`MeshCore: ${meshcoreResult.value.length} active nodes${capped.length < meshcoreResult.value.length ? ` (capped to ${capped.length} most recent)` : ''}`)
  } else {
    console.error(`MeshCore fetch failed: ${meshcoreResult.reason.message}`)
  }

  if (meshtasticResult.status === 'fulfilled') {
    const capped = capToMostRecent(meshtasticResult.value, MAX_NODES_PER_NETWORK)
    nodes.push(...capped)
    console.log(`Meshtastic: ${meshtasticResult.value.length} active nodes${capped.length < meshtasticResult.value.length ? ` (capped to ${capped.length} most recent)` : ''}`)
  } else {
    console.error(`Meshtastic fetch failed: ${meshtasticResult.reason.message}`)
  }

  if (nodes.length === 0) {
    console.error('\nNo nodes fetched from either source — nothing written.')
    process.exitCode = 1
    return
  }

  const output = { generatedAt: new Date().toISOString(), nodes }
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(output, null, 2))
  console.log(`\nWrote ${nodes.length} nodes to ${outPath}`)
  console.log('Load them into the map with the "Import" button in the toolbar.')
}

main()
