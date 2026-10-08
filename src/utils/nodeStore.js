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

