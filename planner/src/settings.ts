// Planner settings: the user's plan (a list of nodes plus shared choices), its defaults, the
// translation into engine jobs, and the URL-hash form that makes a scenario shareable.

import { Climate, Mdvar, Polarization } from './engine/itm'
import { unionGrid, type CoverageJob } from './engine/coverage'
import { terrainPlan } from './engine/run'
import { BANDS, RADIO_PRESETS, loraSensitivityDbm, type LinkBudget } from './engine/radio'
import type { LatLng } from './engine/geo'
import type { PathRadio } from './engine/link'

export type Network = 'meshtastic' | 'meshcore'
export type Detail = 'fast' | 'normal' | 'fine'

export interface GroundType {
  id: string
  label: string
  epsilon: number
  sigma: number
}

/** Standard ITM ground constants. */
export const GROUND_TYPES: GroundType[] = [
  { id: 'average', label: 'Average ground', epsilon: 15, sigma: 0.005 },
  { id: 'poor', label: 'Poor ground (dry, sandy)', epsilon: 4, sigma: 0.001 },
  { id: 'good', label: 'Good ground (wet, fertile)', epsilon: 25, sigma: 0.02 },
  { id: 'fresh', label: 'Fresh water', epsilon: 81, sigma: 0.01 },
  { id: 'sea', label: 'Sea water', epsilon: 81, sigma: 5 },
]

export const CLIMATES: { id: number; label: string }[] = [
  { id: Climate.EQUATORIAL, label: 'Equatorial' },
  { id: Climate.CONTINENTAL_SUBTROPICAL, label: 'Continental subtropical' },
  { id: Climate.MARITIME_SUBTROPICAL, label: 'Maritime subtropical' },
  { id: Climate.DESERT, label: 'Desert' },
  { id: Climate.CONTINENTAL_TEMPERATE, label: 'Continental temperate' },
  { id: Climate.MARITIME_TEMPERATE_OVER_LAND, label: 'Maritime temperate, over land' },
  { id: Climate.MARITIME_TEMPERATE_OVER_SEA, label: 'Maritime temperate, over sea' },
]

export const RADIUS_OPTIONS_KM = [5, 10, 20, 30, 50]

/** How many nodes one plan can hold. Each costs a full coverage calculation. */
export const MAX_NODES = 10
export const MAX_NAME_LENGTH = 24

/** One planned transmitter: where it is and how it is built. */
export interface PlannedNode {
  /** Stable within a plan ("n1", "n2", …); not stored in links. */
  id: string
  name: string
  position: LatLng
  network: Network
  /** A RADIO_PRESETS id, or 'custom' to use sf/bwKhz/freqMhz as entered. */
  presetId: string
  sf: number
  bwKhz: number
  bandId: string
  freqMhz: number
  txPowerDbm: number
  txGainDbi: number
  txCableLossDb: number
  hTxM: number
}

export const NODE_DEFAULTS: Omit<PlannedNode, 'id' | 'name' | 'position'> = {
  network: 'meshtastic',
  presetId: 'mt-long-fast',
  sf: 11,
  bwKhz: 250,
  bandId: 'us915',
  freqMhz: 915,
  txPowerDbm: 22,
  txGainDbi: 2,
  txCableLossDb: 0.5,
  hTxM: 10,
}

/** What a link analysis connects: a planned node to another node, or to a point on the map. */
export type LinkTarget = { kind: 'node'; id: string } | { kind: 'point'; position: LatLng | null }

export interface LinkSpec {
  /** Id of the node at one end. */
  from: string
  to: LinkTarget
}

export interface Settings {
  nodes: PlannedNode[]
  /** The link being analysed, if any (open in the panel on the right). */
  link: LinkSpec | null
  // Shared by every node: the receiving device, and how to calculate.
  rxGainDbi: number
  rxCableLossDb: number
  hRxM: number
  extraLossDb: number
  radiusKm: number
  detail: Detail
  reliability: 50 | 90
  climate: number
  groundId: string
  /** Receiver sensitivity entered by the user, dBm, applied to every node; null derives it from each node's radio. */
  sensitivityOverride: number | null
  /** Country codes of existing-node data to show. */
  regions: string[]
}

export const DEFAULTS: Settings = {
  nodes: [],
  link: null,
  rxGainDbi: 2,
  rxCableLossDb: 0,
  hRxM: 2,
  extraLossDb: 0,
  radiusKm: 20,
  detail: 'normal',
  reliability: 50,
  climate: Climate.CONTINENTAL_TEMPERATE,
  groundId: 'average',
  sensitivityOverride: null,
  regions: [],
}

const DETAIL: Record<Detail, { outCellM: number; terrainCellM: number; label: string }> = {
  fast: { outCellM: 300, terrainCellM: 120, label: 'Fast' },
  normal: { outCellM: 150, terrainCellM: 90, label: 'Normal' },
  fine: { outCellM: 75, terrainCellM: 60, label: 'Fine' },
}
export const DETAIL_LABELS: { id: Detail; label: string }[] = (Object.keys(DETAIL) as Detail[]).map((id) => ({ id, label: DETAIL[id].label }))

/** Terrain sample spacing (metres) for a detail level; links use the same as coverage. */
export const terrainCellM = (d: Detail) => DETAIL[d].terrainCellM

export function presetFor(id: string) {
  return RADIO_PRESETS.find((p) => p.id === id)
}

// ---- Nodes -------------------------------------------------------------------------

export const defaultName = (index: number) => `Node ${index}`

/** The smallest unused "n<k>" id, and k. */
function nextSlot(existing: PlannedNode[]): { id: string; k: number } {
  const used = new Set(existing.map((n) => n.id))
  for (let k = 1; ; k++) if (!used.has(`n${k}`)) return { id: `n${k}`, k }
}

/**
 * A new node at a position. It copies the radio and hardware settings of `template` (normally the
 * node being edited), since a network is usually built from similar nodes.
 */
export function newNode(existing: PlannedNode[], position: LatLng, template?: PlannedNode): PlannedNode {
  const { id, k } = nextSlot(existing)
  const base = template ?? { ...NODE_DEFAULTS }
  return {
    id,
    name: defaultName(k),
    position,
    network: base.network,
    presetId: base.presetId,
    sf: base.sf,
    bwKhz: base.bwKhz,
    bandId: base.bandId,
    freqMhz: base.freqMhz,
    txPowerDbm: base.txPowerDbm,
    txGainDbi: base.txGainDbi,
    txCableLossDb: base.txCableLossDb,
    hTxM: base.hTxM,
  }
}

/** The frequency a node's settings imply, MHz. */
export function effectiveFreqMhz(n: PlannedNode): number {
  const preset = presetFor(n.presetId)
  if (preset?.freqMhz) return preset.freqMhz
  if (n.presetId === 'custom') return n.freqMhz
  return BANDS.find((b) => b.id === n.bandId)?.centreMhz ?? n.freqMhz
}

export function effectiveRadio(n: PlannedNode): { sf: number; bwKhz: number } {
  const preset = presetFor(n.presetId)
  return preset ? { sf: preset.sf, bwKhz: preset.bwKhz } : { sf: n.sf, bwKhz: n.bwKhz }
}

/** Receiver sensitivity in dBm for a node's network: the user's override, or derived from its radio settings. */
export function effectiveSensitivityDbm(n: PlannedNode, s: Pick<Settings, 'sensitivityOverride'>): number {
  if (s.sensitivityOverride !== null) return s.sensitivityOverride
  const { sf, bwKhz } = effectiveRadio(n)
  return loraSensitivityDbm(sf, bwKhz)
}

export function linkBudget(n: PlannedNode, s: Settings): LinkBudget {
  return {
    txPowerDbm: n.txPowerDbm,
    txGainDbi: n.txGainDbi,
    txCableLossDb: n.txCableLossDb,
    rxGainDbi: s.rxGainDbi,
    rxCableLossDb: s.rxCableLossDb,
    extraLossDb: s.extraLossDb,
  }
}

// ---- Engine jobs ----------------------------------------------------------------------

/**
 * The propagation assumptions shared by coverage and link analysis, so the two always agree.
 * ITM's time variability is small (under 2 dB between 10% and 99%); the large spread is situation
 * variability (confidence, roughly +/-9 dB). Cautious planning needs both.
 */
export function pathRadio(s: Settings, fMhz: number): PathRadio {
  const ground = GROUND_TYPES.find((g) => g.id === s.groundId) ?? GROUND_TYPES[0]
  return {
    fMhz,
    climate: s.climate,
    n0: 301,
    pol: Polarization.VERTICAL,
    epsilon: ground.epsilon,
    sigma: ground.sigma,
    mdvar: Mdvar.BROADCAST,
    reliability: s.reliability,
    confidence: s.reliability,
  }
}

/** The job for one node, onto the shared `grid` (see toJobs). */
export function toJob(s: Settings, node: PlannedNode, grid?: CoverageJob['grid']): CoverageJob {
  const radiusM = s.radiusKm * 1000
  const d = DETAIL[s.detail]
  const terrain = terrainPlan(node.position, radiusM, d.terrainCellM)
  const radio = pathRadio(s, effectiveFreqMhz(node))
  return {
    origin: node.position,
    hTxM: node.hTxM,
    hRxM: s.hRxM,
    fMhz: radio.fMhz,
    budget: linkBudget(node, s),
    radiusM,
    outCellM: d.outCellM,
    reliability: radio.reliability,
    confidence: radio.confidence,
    climate: radio.climate,
    n0: radio.n0,
    pol: radio.pol,
    epsilon: radio.epsilon,
    sigma: radio.sigma,
    mdvar: radio.mdvar,
    zoom: terrain.zoom,
    demCellM: terrain.demCellM,
    grid,
  }
}

/**
 * One job per node, all onto the same raster so their results can be combined pixel by pixel.
 * Throws if there are no nodes, or they are too far apart to cover with one raster.
 */
export function toJobs(s: Settings): CoverageJob[] {
  if (s.nodes.length === 0) throw new Error('Place a node on the map first')
  const grid = unionGrid(
    s.nodes.map((n) => n.position),
    s.radiusKm * 1000,
    DETAIL[s.detail].outCellM,
  )
  return s.nodes.map((n) => toJob(s, n, grid))
}

/** A stable key for everything that changes a node's computed map (sensitivity only changes how it is shown). */
export function jobKey(job: CoverageJob): string {
  return JSON.stringify(job)
}

/** Key for a whole plan's calculation: each node's id and job, in order. Null if the plan cannot be calculated. */
export function planKey(s: Settings): string | null {
  try {
    const jobs = toJobs(s)
    return s.nodes.map((n, i) => `${n.id}:${jobKey(jobs[i])}`).join('|')
  } catch {
    return null
  }
}

// ---- URL hash ---------------------------------------------------------------------------
//
// One node (with a default name) keeps the original flat format, so existing links and the
// map's "Plan coverage from here" keep working:  #lat=..&lng=..&tp=22&…
// Several nodes are written as repeated n=<record> parameters; a record is comma-separated:
//   lat,lng,network,preset,band,txPower,txGain,txCable,height,sf,bw,freq,name
// with empty fields meaning "default" and trailing empty fields left off.

const num = (v: string | null | undefined, min: number, max: number, fallback: number): number => {
  if (v === null || v === undefined || v.trim() === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const oneOf = <T extends string | number>(v: string | null | undefined, options: readonly T[], fallback: T): T => {
  const hit = options.find((o) => String(o) === v)
  return hit === undefined ? fallback : hit
}

const BANDWIDTHS = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

function parseCoordinates(lat: string | null | undefined, lng: string | null | undefined): LatLng | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat.trim() === '' || lng.trim() === '') return null
  const la = Number(lat)
  const lo = Number(lng)
  return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 85 && Math.abs(lo) <= 180 ? { lat: la, lng: lo } : null
}

/** Fields in record order; see the format note above. Returns null if the position is unusable. */
function nodeFromFields(f: (string | undefined)[], index: number): PlannedNode | null {
  const position = parseCoordinates(f[0], f[1])
  if (!position) return null
  const d = NODE_DEFAULTS
  const network = oneOf(f[2], ['meshtastic', 'meshcore'] as const, d.network)
  const presetIds = RADIO_PRESETS.filter((p) => p.network === network).map((p) => p.id)
  const defaultPreset = network === 'meshcore' ? 'mc-us' : 'mt-long-fast'
  const presetId = f[3] === 'custom' ? 'custom' : oneOf(f[3], presetIds, defaultPreset)
  let name = defaultName(index)
  if (f[12]) {
    try {
      name = decodeURIComponent(f[12]).trim().slice(0, MAX_NAME_LENGTH) || name
    } catch {
      /* keep the default name */
    }
  }
  return {
    id: `n${index}`,
    name,
    position,
    network,
    presetId,
    sf: Math.round(num(f[9], 5, 12, d.sf)),
    bwKhz: oneOf(f[10], BANDWIDTHS, d.bwKhz) as number,
    bandId: oneOf(f[4], BANDS.map((b) => b.id), d.bandId),
    freqMhz: num(f[11], 150, 1000, d.freqMhz),
    txPowerDbm: num(f[5], 0, 36, d.txPowerDbm),
    txGainDbi: num(f[6], -10, 25, d.txGainDbi),
    txCableLossDb: num(f[7], 0, 20, d.txCableLossDb),
    hTxM: num(f[8], 1, 300, d.hTxM),
  }
}

/**
 * A link is written lk=<from>:<to>, with nodes counted from 1 in plan order: "1:2" is node 1 to
 * node 2, "1:54.5,-3.0" is node 1 to a point, and "1:" is node 1 to a target not yet placed.
 */
function parseLink(raw: string | null, nodes: PlannedNode[]): LinkSpec | null {
  if (!raw) return null
  const [fromRaw, toRaw] = raw.split(':')
  const fromIndex = /^\d+$/.test(fromRaw ?? '') ? Number(fromRaw) : 0
  const from = nodes[fromIndex - 1]
  if (!from || toRaw === undefined) return null
  if (toRaw === '') return { from: from.id, to: { kind: 'point', position: null } }
  if (/^\d+$/.test(toRaw)) {
    const to = nodes[Number(toRaw) - 1]
    return to && to.id !== from.id ? { from: from.id, to: { kind: 'node', id: to.id } } : null
  }
  const [lat, lng] = toRaw.split(',')
  const position = parseCoordinates(lat, lng)
  return position ? { from: from.id, to: { kind: 'point', position } } : null
}

/** Parse a URL hash (with or without the leading #). Unknown or invalid values fall back to defaults. */
export function parseSettings(hash: string): Settings {
  const q = new URLSearchParams(hash.replace(/^#/, ''))

  const nodes: PlannedNode[] = []
  const records = q.getAll('n')
  if (records.length > 0) {
    for (const rec of records.slice(0, MAX_NODES)) {
      const node = nodeFromFields(rec.split(','), nodes.length + 1)
      if (node) nodes.push(node)
    }
  } else {
    // the original single-node format
    const node = nodeFromFields(
      [q.get('lat'), q.get('lng'), q.get('net'), q.get('rp'), q.get('bd'), q.get('tp'), q.get('tg'), q.get('tc'), q.get('th'), q.get('sf'), q.get('bw'), q.get('fq')].map((v) => v ?? undefined),
      1,
    )
    if (node) nodes.push(node)
  }

  const sens = q.get('sens')
  return {
    nodes,
    link: parseLink(q.get('lk'), nodes),
    rxGainDbi: num(q.get('rg'), -10, 25, DEFAULTS.rxGainDbi),
    rxCableLossDb: num(q.get('rc'), 0, 20, DEFAULTS.rxCableLossDb),
    hRxM: num(q.get('rh'), 0.5, 100, DEFAULTS.hRxM),
    extraLossDb: num(q.get('xl'), 0, 60, DEFAULTS.extraLossDb),
    radiusKm: Number(oneOf(q.get('rk'), RADIUS_OPTIONS_KM.map(String), String(DEFAULTS.radiusKm))),
    detail: oneOf(q.get('dt'), ['fast', 'normal', 'fine'] as const, DEFAULTS.detail),
    reliability: oneOf(q.get('rel'), ['50', '90'] as const, '50') === '90' ? 90 : 50,
    climate: Number(oneOf(q.get('cl'), CLIMATES.map((c) => String(c.id)), String(DEFAULTS.climate))),
    groundId: oneOf(q.get('gr'), GROUND_TYPES.map((g) => g.id), DEFAULTS.groundId),
    sensitivityOverride: sens !== null && sens !== '' && Number.isFinite(Number(sens)) ? Math.min(-60, Math.max(-160, Number(sens))) : null,
    regions: (q.get('r') ?? '')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c))
      .slice(0, 12),
  }
}

const r = (n: number, dp = 6) => String(Math.round(n * 10 ** dp) / 10 ** dp)

/** The node's fields as strings in record order, '' where the value is the default. */
function nodeFields(n: PlannedNode, index: number): string[] {
  const d = NODE_DEFAULTS
  const defaultPreset = n.network === 'meshcore' ? 'mc-us' : 'mt-long-fast'
  const custom = n.presetId === 'custom'
  return [
    r(n.position.lat),
    r(n.position.lng),
    n.network !== d.network ? n.network : '',
    n.presetId !== defaultPreset ? n.presetId : '',
    n.bandId !== d.bandId ? n.bandId : '',
    n.txPowerDbm !== d.txPowerDbm ? r(n.txPowerDbm, 3) : '',
    n.txGainDbi !== d.txGainDbi ? r(n.txGainDbi, 3) : '',
    n.txCableLossDb !== d.txCableLossDb ? r(n.txCableLossDb, 3) : '',
    n.hTxM !== d.hTxM ? r(n.hTxM, 3) : '',
    custom ? String(n.sf) : '',
    custom ? String(n.bwKhz) : '',
    custom && n.freqMhz !== d.freqMhz ? r(n.freqMhz, 3) : '',
    n.name !== defaultName(index) ? encodeURIComponent(n.name) : '',
  ]
}

/** Serialise only what differs from the defaults, so links stay short. */
export function toHash(s: Settings): string {
  const q = new URLSearchParams()
  const d = DEFAULTS
  const single = s.nodes.length === 1 && s.nodes[0].name === defaultName(1)

  if (single) {
    const f = nodeFields(s.nodes[0], 1)
    const keys = ['lat', 'lng', 'net', 'rp', 'bd', 'tp', 'tg', 'tc', 'th', 'sf', 'bw', 'fq']
    keys.forEach((k, i) => {
      if (f[i] !== '') q.set(k, f[i])
    })
  } else {
    s.nodes.forEach((n, i) => {
      const f = nodeFields(n, i + 1)
      while (f.length > 2 && f[f.length - 1] === '') f.pop()
      q.append('n', f.join(','))
    })
  }

  if (s.link) {
    const fromIndex = s.nodes.findIndex((n) => n.id === s.link?.from) + 1
    const to = s.link.to
    const toIndex = to.kind === 'node' ? s.nodes.findIndex((n) => n.id === to.id) + 1 : 0
    if (fromIndex > 0 && (to.kind === 'point' || toIndex > 0)) {
      q.set('lk', `${fromIndex}:${to.kind === 'node' ? toIndex : to.position ? `${r(to.position.lat)},${r(to.position.lng)}` : ''}`)
    }
  }

  const pairs: [string, number, number][] = [
    ['rg', s.rxGainDbi, d.rxGainDbi],
    ['rc', s.rxCableLossDb, d.rxCableLossDb],
    ['rh', s.hRxM, d.hRxM],
    ['xl', s.extraLossDb, d.extraLossDb],
    ['rk', s.radiusKm, d.radiusKm],
    ['cl', s.climate, d.climate],
  ]
  for (const [k, v, def] of pairs) if (v !== def) q.set(k, r(v, 3))
  if (s.detail !== d.detail) q.set('dt', s.detail)
  if (s.reliability !== d.reliability) q.set('rel', String(s.reliability))
  if (s.groundId !== d.groundId) q.set('gr', s.groundId)
  if (s.sensitivityOverride !== null) q.set('sens', r(s.sensitivityOverride, 1))
  if (s.regions.length) q.set('r', s.regions.join(','))
  // commas and colons are fine in a URL fragment and much easier to read
  return q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')
}
