#!/usr/bin/env node
// Fetches current node data from the MeshCore and Meshtastic public APIs and
// shards it by country, so the frontend can load just one region's nodes
// instead of a global blob. Two uses:
//   1. Run it yourself to get per-country files you can load into the map
//      with the "Import" button (pick the country you want).
//   2. Run as part of the GitHub Pages build (see .github/workflows/deploy.yml)
//      to embed a periodically-refreshed set of per-country files the
//      frontend's region picker fetches from on demand.
//
// Runs server-side (Node, not a browser) so it isn't subject to the CORS
// restrictions that block these same fetches from the deployed GitHub Pages
// site — see README.md's "Live data feeds" section for why.
//
// Earlier versions of this script filtered to "recently active" nodes and/or
// capped the total count, both to keep a single global file small. Sharding
// by country solves that same problem without either: no timestamp field
// needs to be trusted, and no country's data gets arbitrarily truncated.
//
// Usage: node scripts/pull-live-nodes.mjs [output-dir]

import { mkdir, writeFile } from 'node:fs/promises'
import { fetchMeshcoreNodes } from '../src/api/meshcoreLive.js'
import { fetchMeshtasticNodes } from '../src/api/meshtasticLive.js'
import { getCountryForPoint } from './lib/countryLookup.mjs'

const outDir = process.argv[2] || 'public/regions'

async function main() {
  const [meshcoreResult, meshtasticResult] = await Promise.allSettled([
    fetchMeshcoreNodes(),
    fetchMeshtasticNodes(),
  ])

  const nodes = []
  if (meshcoreResult.status === 'fulfilled') {
    nodes.push(...meshcoreResult.value)
    console.log(`MeshCore: ${meshcoreResult.value.length} nodes`)
  } else {
    console.error(`MeshCore fetch failed: ${meshcoreResult.reason.message}`)
  }

  if (meshtasticResult.status === 'fulfilled') {
    nodes.push(...meshtasticResult.value)
    console.log(`Meshtastic: ${meshtasticResult.value.length} nodes`)
  } else {
    console.error(`Meshtastic fetch failed: ${meshtasticResult.reason.message}`)
  }

  if (nodes.length === 0) {
    console.error('\nNo nodes fetched from either source — nothing written.')
    process.exitCode = 1
    return
  }

  const byCountry = new Map() // code -> { name, nodes: [] }
  let unassigned = 0

  for (const node of nodes) {
    const country = getCountryForPoint(node.lat, node.lng)
    if (!country) {
      unassigned++
      continue
    }
    if (!byCountry.has(country.code)) byCountry.set(country.code, { name: country.name, nodes: [] })
    byCountry.get(country.code).nodes.push(node)
  }

  await mkdir(outDir, { recursive: true })

  const generatedAt = new Date().toISOString()
  const index = []
  for (const [code, { name, nodes: countryNodes }] of byCountry) {
    await writeFile(
      `${outDir}/${code}.json`,
      JSON.stringify({ generatedAt, country: { code, name }, nodes: countryNodes }, null, 2),
    )
    index.push({ code, name, count: countryNodes.length })
  }
  index.sort((a, b) => a.name.localeCompare(b.name))
  await writeFile(`${outDir}/index.json`, JSON.stringify({ generatedAt, regions: index }, null, 2))

  console.log(
    `\nWrote ${index.length} country files (${nodes.length - unassigned} nodes) to ${outDir}/` +
      (unassigned ? ` (${unassigned} nodes had no country match — likely offshore/open-water coordinates)` : ''),
  )
  console.log('Pick a region in the map\'s Live data panel to load it, or Import a country file directly.')
}

main()
