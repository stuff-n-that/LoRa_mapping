import seedNodes from '../data/nodes.json'

const STORAGE_KEY = 'lora-mapping-nodes-v1'

export function loadNodes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // fall through to seed data
  }
  return structuredClone(seedNodes)
}

export function persistNodes(nodes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes))
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — silently skip
  }
}

export function createNode({ name, network, lat, lng, hardware, notes }) {
  return {
    id: crypto.randomUUID(),
    name: name?.trim() || 'Unnamed node',
    network,
    lat,
    lng,
    hardware: hardware?.trim() || '',
    notes: notes?.trim() || '',
    lastSeen: '',
    source: 'manual',
  }
}

export function resetToSample() {
  return structuredClone(seedNodes)
}

export function downloadNodesAsFile(nodes) {
  const blob = new Blob([JSON.stringify(nodes, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lora-mesh-nodes-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function readNodesFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        // Accepts a bare array (Export's own format) or { nodes: [...] }
        // (pull-live-nodes.mjs's format, which also carries generatedAt).
        const nodeList = Array.isArray(parsed) ? parsed : parsed?.nodes
        if (!Array.isArray(nodeList)) throw new Error('Expected a JSON array of nodes, or { "nodes": [...] }')
        const valid = nodeList.every(
          (n) =>
            n &&
            typeof n.lat === 'number' &&
            typeof n.lng === 'number' &&
            (n.network === 'meshcore' || n.network === 'meshtastic'),
        )
        if (!valid) throw new Error('Each node needs lat, lng (numbers) and network ("meshcore" or "meshtastic")')
        resolve(
          nodeList.map((n) => ({
            id: n.id || crypto.randomUUID(),
            name: n.name || 'Unnamed node',
            network: n.network,
            lat: n.lat,
            lng: n.lng,
            hardware: n.hardware || '',
            notes: n.notes || '',
            lastSeen: n.lastSeen || '',
            source: 'manual',
          })),
        )
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
