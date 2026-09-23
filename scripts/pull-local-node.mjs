#!/usr/bin/env node
// Ground-truth check: reads your own Meshtastic node's local node database
// (via scripts/local-node/read_meshtastic_nodes.py) and compares the
// neighbours you actually hear directly (hopsAway === 0) against what the
// public community map claims for those same node IDs — flagging anyone
// missing from the public map, or placed implausibly far from you.
//
// This is separate from scripts/pull-live-nodes.mjs on purpose: that script
// builds the map's public-data layer; this one audits it against your own
// hardware. Needs Python + `pip install meshtastic` on this machine, and a
// Meshtastic node reachable over USB serial or Wi-Fi. NOT YET TESTED END TO
// END against real hardware — see read_meshtastic_nodes.py's header.
//
// Usage:
//   node scripts/pull-local-node.mjs --lat 51.50 --lng -0.12                  # USB serial
//   node scripts/pull-local-node.mjs --lat 51.50 --lng -0.12 --host 192.168.1.50
//   node scripts/pull-local-node.mjs --lat 51.50 --lng -0.12 --public-file public/regions/GB.json

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { normalizeLocalNodes } from '../src/api/meshtasticLocal.js'
import { checkLocalNeighbourPlausibility } from '../src/utils/checkPlausibility.js'
import { fetchMeshtasticNodes } from '../src/api/meshtasticLive.js'

const execFileAsync = promisify(execFile)
const pythonScript = fileURLToPath(new URL('./local-node/read_meshtastic_nodes.py', import.meta.url))

function parseArgs(argv) {
  const args = { lat: null, lng: null, host: null, port: null, publicFile: null }
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    if (argv[i] === '--lat') args.lat = Number(value)
    if (argv[i] === '--lng') args.lng = Number(value)
    if (argv[i] === '--host') args.host = value
    if (argv[i] === '--port') args.port = value
    if (argv[i] === '--public-file') args.publicFile = value
  }
  return args
}

async function readLocalNodes({ host, port }) {
  const pyArgs = []
  if (host) pyArgs.push('--host', host)
  if (port) pyArgs.push('--port', port)
  const { stdout } = await execFileAsync('python3', [pythonScript, ...pyArgs], { maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function loadPublicNodes(publicFile) {
  if (publicFile) {
    const data = JSON.parse(await readFile(publicFile, 'utf8'))
    return data.nodes || []
  }
  // No pre-pulled region file given — fetch fresh from the community API
  // directly (only works where that isn't CORS-blocked, i.e. from Node, not
  // the deployed site — see README's "Live data feeds" section).
  return fetchMeshtasticNodes()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.lat === null || args.lng === null || Number.isNaN(args.lat) || Number.isNaN(args.lng)) {
    console.error('Usage: node scripts/pull-local-node.mjs --lat <your latitude> --lng <your longitude> [--host <ip> | --port <serial port>] [--public-file <path>]')
    process.exitCode = 1
    return
  }

  console.log('Reading local node database…')
  const rawNodes = await readLocalNodes(args)
  const localNodes = normalizeLocalNodes(rawNodes)
  const directNeighbours = localNodes.filter((n) => n.heardDirectly)
  console.log(`Local node DB: ${localNodes.length} known nodes, ${directNeighbours.length} heard directly (hopsAway 0)`)

  console.log('Loading public map data for comparison…')
  const publicNodes = await loadPublicNodes(args.publicFile)
  // Public nodes use ids like "meshtastic-live-<node_id>" / "snapshot-meshtastic-live-<node_id>";
  // local ids are "meshtastic-local-<node_id>" — match on the bare node_id suffix.
  const publicById = new Map()
  for (const n of publicNodes) {
    const bareId = n.id.replace(/^(snapshot-)?meshtastic-live-/, '')
    publicById.set(`meshtastic-local-${bareId}`, n)
  }

  const report = checkLocalNeighbourPlausibility(localNodes, publicById, { myLat: args.lat, myLng: args.lng })

  const missing = report.filter((r) => r.status === 'not-on-public-map')
  const implausible = report.filter((r) => r.status === 'implausible-distance')
  const ok = report.filter((r) => r.status === 'ok')

  console.log(`\n${ok.length} directly-heard neighbours match the public map at a plausible distance.`)
  if (missing.length) {
    console.log(`\n${missing.length} heard directly but not on the public map (may simply not report publicly):`)
    for (const m of missing) console.log(`  - ${m.name} (${m.id})`)
  }
  if (implausible.length) {
    console.log(`\n${implausible.length} heard directly but public position looks implausibly far away:`)
    for (const m of implausible) console.log(`  - ${m.name} (${m.id}): public map puts them ${m.distanceKm}km away`)
  }
}

main().catch((err) => {
  console.error('Failed:', err.message)
  process.exitCode = 1
})
