// Existing mesh nodes, read from the same per-country snapshots the main map uses.
//
// The map's deploy publishes them under /map/regions/ (index.json plus one file per
// country). The planner reads them from there rather than keeping its own copy.

import { ROLE_CATEGORIES } from '@shared/nodeRoles.js'

export type NodeNetwork = 'meshcore' | 'meshtastic'

export interface ExistingNode {
  id: string
  name: string
  network: NodeNetwork
  lat: number
  lng: number
  roleCategory: string
  roleRaw: string | null
  lastSeen: string
}

export interface RegionInfo {
  code: string
  name: string
  count: number
}

export { ROLE_CATEGORIES }

/** Where the region files live, relative to the planner page. Override with VITE_REGIONS_BASE. */
export const REGIONS_BASE: string = import.meta.env.VITE_REGIONS_BASE ?? '../map/regions/'

interface RawNode {
  id?: unknown
  name?: unknown
  network?: unknown
  lat?: unknown
  lng?: unknown
  roleCategory?: unknown
  roleRaw?: unknown
  lastSeen?: unknown
}

/** A coordinate must be a real number (or numeric string); Number(null) would silently become 0. */
function coordinate(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

/** Validate a record from a region file; returns null for anything unusable. */
export function parseNode(raw: RawNode, index: number): ExistingNode | null {
  const lat = coordinate(raw.lat)
  const lng = coordinate(raw.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const network = raw.network === 'meshcore' || raw.network === 'meshtastic' ? raw.network : null
  if (!network) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${network}-${index}`,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Unnamed node',
    network,
    lat,
    lng,
    roleCategory: typeof raw.roleCategory === 'string' ? raw.roleCategory : 'other',
    roleRaw: typeof raw.roleRaw === 'string' ? raw.roleRaw : null,
    lastSeen: typeof raw.lastSeen === 'string' ? raw.lastSeen : '',
  }
}

export async function fetchRegionIndex(signal?: AbortSignal, base = REGIONS_BASE): Promise<RegionInfo[]> {
  const res = await fetch(`${base}index.json`, { signal })
  if (!res.ok) throw new Error(`region list responded ${res.status}`)
  const data = (await res.json()) as { regions?: RegionInfo[] }
  if (!Array.isArray(data.regions)) throw new Error('region list has an unexpected format')
  return data.regions
}

export async function fetchRegion(code: string, signal?: AbortSignal, base = REGIONS_BASE): Promise<ExistingNode[]> {
  if (!/^[A-Z]{2}$/.test(code)) throw new Error(`invalid region code ${code}`)
  const res = await fetch(`${base}${code}.json`, { signal })
  if (!res.ok) throw new Error(`${code} responded ${res.status}`)
  const data = (await res.json()) as { nodes?: RawNode[] }
  if (!Array.isArray(data.nodes)) throw new Error(`${code} has an unexpected format`)
  const out: ExistingNode[] = []
  data.nodes.forEach((raw, i) => {
    const n = parseNode(raw, i)
    if (n) out.push(n)
  })
  return out
}
