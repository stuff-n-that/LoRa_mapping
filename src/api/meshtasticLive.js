// Reverse-engineered from github.com/liamcottle/meshtastic-map (src/index.js,
// prisma/schema.prisma). Uses the public community instance at
// meshtastic.liamcottle.net, which runs an Express API serving its own map
// frontend from the SAME origin — unlike the MeshCore API, there's no proof
// it sends CORS headers for other origins. A blocked/failing fetch here is
// expected in some browsers and is handled as a soft error by the caller.
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
  }
}

export async function fetchMeshtasticNodes({ signal } = {}) {
  const res = await fetch(MESHTASTIC_API_URL, { signal })
  if (!res.ok) throw new Error(`Meshtastic API responded ${res.status}`)
  const data = await res.json()
  const rawNodes = Array.isArray(data) ? data : data?.nodes || []
  return rawNodes.map(normalize).filter(Boolean)
}
