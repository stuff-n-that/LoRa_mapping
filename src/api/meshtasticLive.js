import { meshtasticRoleCategory } from '../utils/nodeRoles.js'

// Reverse-engineered from github.com/liamcottle/meshtastic-map (src/index.js,
// prisma/schema.prisma). Uses the public community instance at
// meshtastic.liamcottle.net, which runs an Express API serving its own map
// frontend from the SAME origin. Confirmed in production: it rejects our
// GitHub Pages origin, same as MeshCore. Only ever called server-side
// (scripts/pull-live-nodes.mjs, scripts/pull-local-node.mjs) — never from
// the browser.
const MESHTASTIC_API_URL = 'https://meshtastic.liamcottle.net/api/v1/nodes'

// Meshtastic protobuf positions are fixed-point ints: degrees * 1e7.
const POSITION_SCALE = 1e7

function normalize(raw) {
  if (typeof raw.latitude !== 'number' || typeof raw.longitude !== 'number') return null

  const name = raw.long_name || raw.short_name || `Node ${raw.node_id}`
  return {
    id: `meshtastic-live-${raw.node_id}`,
    name,
    network: 'meshtastic',
    lat: raw.latitude / POSITION_SCALE,
    lng: raw.longitude / POSITION_SCALE,
    hardware: typeof raw.hardware_model === 'number' ? `Hardware model #${raw.hardware_model}` : '',
    notes: raw.short_name && raw.short_name !== name ? `Short name: ${raw.short_name}` : '',
    lastSeen: raw.position_updated_at || raw.updated_at || '',
    source: 'live',
    // raw.role is the numeric Meshtastic DeviceConfig.Role enum (0-12); the
    // API also sends role_name (e.g. "ROUTER") alongside it — kept as-is for
    // display since it's already human-readable, no local enum needed for that part.
    roleCategory: meshtasticRoleCategory(raw.role),
    roleRaw: raw.role_name || null,
  }
}

export async function fetchMeshtasticNodes({ signal } = {}) {
  const res = await fetch(MESHTASTIC_API_URL, { signal })
  if (!res.ok) throw new Error(`Meshtastic API responded ${res.status}`)
  const data = await res.json()
  const rawNodes = Array.isArray(data) ? data : data?.nodes || []
  return rawNodes.map(normalize).filter(Boolean)
}
