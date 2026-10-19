// Planner settings: the user's choices, their defaults, the translation into an
// engine job, and the URL-hash form that makes a scenario shareable.

import { Climate, Mdvar, Polarization } from './engine/itm'
import type { CoverageJob } from './engine/coverage'
import { terrainPlan } from './engine/run'
import { BANDS, RADIO_PRESETS, loraSensitivityDbm, type LinkBudget } from './engine/radio'
import type { LatLng } from './engine/geo'

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

export interface Settings {
  node: LatLng | null
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
  rxGainDbi: number
  rxCableLossDb: number
  hRxM: number
  extraLossDb: number
  radiusKm: number
  detail: Detail
  reliability: 50 | 90
  climate: number
  groundId: string
  /** Receiver sensitivity entered by the user, dBm; null means derive it from the radio settings. */
  sensitivityOverride: number | null
  /** Country codes of existing-node data to show. */
  regions: string[]
}

export const DEFAULTS: Settings = {
  node: null,
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

export function presetFor(id: string) {
  return RADIO_PRESETS.find((p) => p.id === id)
}

/** The frequency the settings imply, MHz. */
export function effectiveFreqMhz(s: Settings): number {
  const preset = presetFor(s.presetId)
  if (preset?.freqMhz) return preset.freqMhz
  if (s.presetId === 'custom') return s.freqMhz
  return BANDS.find((b) => b.id === s.bandId)?.centreMhz ?? s.freqMhz
}

export function effectiveRadio(s: Settings): { sf: number; bwKhz: number } {
  const preset = presetFor(s.presetId)
  return preset ? { sf: preset.sf, bwKhz: preset.bwKhz } : { sf: s.sf, bwKhz: s.bwKhz }
}

/** Receiver sensitivity in dBm: the user's override, or derived from the radio settings. */
export function effectiveSensitivityDbm(s: Settings): number {
  if (s.sensitivityOverride !== null) return s.sensitivityOverride
  const { sf, bwKhz } = effectiveRadio(s)
  return loraSensitivityDbm(sf, bwKhz)
}

export function linkBudget(s: Settings): LinkBudget {
  return {
    txPowerDbm: s.txPowerDbm,
    txGainDbi: s.txGainDbi,
    txCableLossDb: s.txCableLossDb,
    rxGainDbi: s.rxGainDbi,
    rxCableLossDb: s.rxCableLossDb,
    extraLossDb: s.extraLossDb,
  }
}

/** Translate settings into an engine job. Throws if no node has been placed. */
export function toJob(s: Settings): CoverageJob {
  if (!s.node) throw new Error('Place a node on the map first')
  const radiusM = s.radiusKm * 1000
  const d = DETAIL[s.detail]
  const terrain = terrainPlan(s.node, radiusM, d.terrainCellM)
  const ground = GROUND_TYPES.find((g) => g.id === s.groundId) ?? GROUND_TYPES[0]
  return {
    origin: s.node,
    hTxM: s.hTxM,
    hRxM: s.hRxM,
    fMhz: effectiveFreqMhz(s),
    budget: linkBudget(s),
    radiusM,
    outCellM: d.outCellM,
    // ITM's time variability is small (under 2 dB between 10% and 99%); the large spread is
    // situation variability (confidence, roughly +/-9 dB). Cautious planning needs both.
    reliability: s.reliability,
    confidence: s.reliability,
    climate: s.climate,
    n0: 301,
    pol: Polarization.VERTICAL,
    epsilon: ground.epsilon,
    sigma: ground.sigma,
    mdvar: Mdvar.BROADCAST,
    zoom: terrain.zoom,
    demCellM: terrain.demCellM,
  }
}

/** A stable key for everything that changes the computed map (sensitivity only changes how it is shown). */
export function jobKey(job: CoverageJob): string {
  return JSON.stringify(job)
}

// ---- URL hash ---------------------------------------------------------------------

const num = (v: string | null, min: number, max: number, fallback: number): number => {
  if (v === null || v.trim() === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const oneOf = <T extends string | number>(v: string | null, options: readonly T[], fallback: T): T => {
  const hit = options.find((o) => String(o) === v)
  return hit === undefined ? fallback : hit
}

function parseHash(hash: string): Settings {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const lat = q.get('lat')
  const lng = q.get('lng')
  const node =
    lat !== null && lng !== null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 85 && Math.abs(Number(lng)) <= 180
      ? { lat: Number(lat), lng: Number(lng) }
      : null

  const network = oneOf(q.get('net'), ['meshtastic', 'meshcore'] as const, DEFAULTS.network)
  const presetIds = RADIO_PRESETS.filter((p) => p.network === network).map((p) => p.id)
  const defaultPreset = network === 'meshcore' ? 'mc-us' : 'mt-long-fast'
  const presetId = q.get('rp') === 'custom' ? 'custom' : oneOf(q.get('rp'), presetIds, defaultPreset)
  const sens = q.get('sens')

  return {
    node,
    network,
    presetId,
    sf: Math.round(num(q.get('sf'), 5, 12, DEFAULTS.sf)),
    bwKhz: oneOf(q.get('bw'), [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500], DEFAULTS.bwKhz) as number,
    bandId: oneOf(q.get('bd'), BANDS.map((b) => b.id), DEFAULTS.bandId),
    freqMhz: num(q.get('fq'), 150, 1000, DEFAULTS.freqMhz),
    txPowerDbm: num(q.get('tp'), 0, 36, DEFAULTS.txPowerDbm),
    txGainDbi: num(q.get('tg'), -10, 25, DEFAULTS.txGainDbi),
    txCableLossDb: num(q.get('tc'), 0, 20, DEFAULTS.txCableLossDb),
    hTxM: num(q.get('th'), 1, 300, DEFAULTS.hTxM),
    rxGainDbi: num(q.get('rg'), -10, 25, DEFAULTS.rxGainDbi),
    rxCableLossDb: num(q.get('rc'), 0, 20, DEFAULTS.rxCableLossDb),
    hRxM: num(q.get('rh'), 0.5, 100, DEFAULTS.hRxM),
    extraLossDb: num(q.get('xl'), 0, 60, DEFAULTS.extraLossDb),
    radiusKm: oneOf(q.get('rk'), RADIUS_OPTIONS_KM.map(String), String(DEFAULTS.radiusKm)) as unknown as number,
    detail: oneOf(q.get('dt'), ['fast', 'normal', 'fine'] as const, DEFAULTS.detail),
    reliability: oneOf(q.get('rel'), ['50', '90'] as const, '50') === '90' ? 90 : 50,
    climate: oneOf(q.get('cl'), CLIMATES.map((c) => String(c.id)), String(DEFAULTS.climate)) as unknown as number,
    groundId: oneOf(q.get('gr'), GROUND_TYPES.map((g) => g.id), DEFAULTS.groundId),
    sensitivityOverride: sens !== null && sens !== '' && Number.isFinite(Number(sens)) ? Math.min(-60, Math.max(-160, Number(sens))) : null,
    regions: (q.get('r') ?? '')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c))
      .slice(0, 12),
  }
}

/** Parse a URL hash (with or without the leading #). Unknown or invalid values fall back to defaults. */
export function parseSettings(hash: string): Settings {
  const s = parseHash(hash)
  // radius and climate come through the option lists as strings
  return { ...s, radiusKm: Number(s.radiusKm), climate: Number(s.climate) }
}

const r = (n: number, dp = 6) => String(Math.round(n * 10 ** dp) / 10 ** dp)

/** Serialise only what differs from the defaults, so links stay short. */
export function toHash(s: Settings): string {
  const q = new URLSearchParams()
  const d = DEFAULTS
  if (s.node) {
    q.set('lat', r(s.node.lat))
    q.set('lng', r(s.node.lng))
  }
  if (s.network !== d.network) q.set('net', s.network)
  const defaultPreset = s.network === 'meshcore' ? 'mc-us' : 'mt-long-fast'
  if (s.presetId !== defaultPreset) q.set('rp', s.presetId)
  if (s.presetId === 'custom') {
    q.set('sf', String(s.sf))
    q.set('bw', String(s.bwKhz))
  }
  if (s.bandId !== d.bandId) q.set('bd', s.bandId)
  if (s.presetId === 'custom' && s.freqMhz !== d.freqMhz) q.set('fq', r(s.freqMhz, 3))
  const pairs: [string, number, number][] = [
    ['tp', s.txPowerDbm, d.txPowerDbm],
    ['tg', s.txGainDbi, d.txGainDbi],
    ['tc', s.txCableLossDb, d.txCableLossDb],
    ['th', s.hTxM, d.hTxM],
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
  return q.toString()
}
