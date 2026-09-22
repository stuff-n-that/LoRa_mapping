import { unpack } from 'msgpackr'
import { fetchFromLiveProxy } from './liveProxy.js'

// Reverse-engineered from the official MeshCore map frontend
// (github.com/meshcore-dev/map.meshcore.io, src/map.js), which runs on
// map.meshcore.io and fetches this same endpoint from map.meshcore.dev.
// In production this rejects our GitHub Pages origin (see README) — the
// VITE_LIVE_PROXY branch below is the real fix; this direct fetch stays as
// the fallback and is what actually runs from Node (scripts, server/).
const MESHCORE_API_URL = 'https://map.meshcore.dev/api/v1/nodes?binary=1&short=1'

// The API returns MessagePack with abbreviated keys (the "short=1" flag) to
// save bandwidth. This inflates them back to full names, same mapping the
// official frontend uses. lat/lon are NOT abbreviated in either mode.
const SHORT_KEY_MAP = {
  pk: 'public_key',
  t: 'type',
  n: 'adv_name',
  la: 'last_advert',
  id: 'inserted_date',
  ud: 'updated_date',
  p: 'params',
  l: 'link',
  s: 'source',
}

const NODE_TYPES = {
  1: 'Client',
  2: 'Repeater',
  3: 'Room Server',
  4: 'Sensor',
}

function toHex(bytes) {
  if (!bytes) return ''
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function inflateNode(raw) {
  const node = {}
  for (const [key, value] of Object.entries(raw)) {
    node[SHORT_KEY_MAP[key] || key] = value
  }
  return node
}

function normalize(raw) {
  const node = inflateNode(raw)
  if (typeof node.lat !== 'number' || typeof node.lon !== 'number') return null

  const publicKeyHex = toHex(node.public_key)
  return {
    id: `meshcore-live-${publicKeyHex || node.adv_name || Math.random()}`,
    name: node.adv_name || 'Unnamed MeshCore node',
    network: 'meshcore',
    lat: node.lat,
    lng: node.lon,
    hardware: NODE_TYPES[node.type] || '',
    notes: publicKeyHex ? `Public key: ${publicKeyHex.slice(0, 16)}…` : '',
    lastSeen: node.last_advert || node.updated_date || '',
    source: 'live',
  }
}

export async function fetchMeshcoreNodes({ signal } = {}) {
  // import.meta.env only exists in a Vite-built browser bundle, so this
  // branch is unreachable from the pull-live-nodes script or the local
  // server — both always fetch upstream directly, which is the point.
  if (import.meta.env?.VITE_LIVE_PROXY === 'true') return fetchFromLiveProxy('meshcore', signal)

  const res = await fetch(MESHCORE_API_URL, { signal })
  if (!res.ok) throw new Error(`MeshCore API responded ${res.status}`)
  const buffer = await res.arrayBuffer()
  const decoded = unpack(new Uint8Array(buffer))
  const rawNodes = Array.isArray(decoded) ? decoded : decoded?.nodes || []
  return rawNodes.map(normalize).filter(Boolean)
}
