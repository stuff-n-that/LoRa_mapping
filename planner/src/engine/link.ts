// Point-to-point link analysis: the terrain between two antennas, whether it blocks the line of
// sight or the first Fresnel zone, the ITM path loss, and a plain-language verdict.
//
// Everything here is pure (no network): a terrain profile goes in, numbers and chart data come out.

import { AzimuthalEquidistant, EARTH_RADIUS_M, type LatLng } from './geo'
import { PropMode, Warn, itmP2PTls, type ItmParams } from './itm'
import { receivedPowerDbm, type LinkBudget } from './radio'

/** Most terrain samples along a link. */
export const MAX_LINK_POINTS = 1500
/** Margin (dB over what the receiver needs) below which a link has little room for fading or foliage. */
export const GOOD_MARGIN_DB = 10
/** The usual aim: at least 60% of the first Fresnel zone's radius clear of obstacles. */
export const GOOD_FRESNEL_PCT = 60
/** Standard effective earth radius factor, used when the model could not supply its own. */
const K_FACTOR = 4 / 3
const SPEED_OF_LIGHT_M_US = 299.792458

export interface TerrainProfile {
  distanceM: number
  /** Ground elevation (m above sea level) at np + 1 evenly spaced points from the first antenna to the second. */
  elevation: Float64Array
}

/** Ground elevation along the great circle from a to b, about `cellM` apart (never more than MAX_LINK_POINTS samples). */
export function sampleProfile(source: { sample(lat: number, lng: number): number }, a: LatLng, b: LatLng, cellM: number): TerrainProfile {
  const proj = new AzimuthalEquidistant(a)
  const end = { x: 0, y: 0 }
  proj.forward(b.lat, b.lng, end)
  const distanceM = Math.hypot(end.x, end.y)
  const np = Math.max(2, Math.min(MAX_LINK_POINTS, Math.round(distanceM / cellM)))
  const elevation = new Float64Array(np + 1)
  const ll = { lat: 0, lng: 0 }
  for (let i = 0; i <= np; i++) {
    proj.inverse((end.x * i) / np, (end.y * i) / np, ll)
    elevation[i] = source.sample(ll.lat, ll.lng)
  }
  return { distanceM, elevation }
}

/** The point a fraction t (0..1) of the way along the path from a to b. */
export function pointAlongPath(a: LatLng, b: LatLng, t: number): LatLng {
  const proj = new AzimuthalEquidistant(a)
  const end = { x: 0, y: 0 }
  proj.forward(b.lat, b.lng, end)
  const out = { lat: 0, lng: 0 }
  proj.inverse(end.x * t, end.y * t, out)
  return out
}

export interface PathRadio {
  fMhz: number
  climate: number
  n0: number
  pol: number
  epsilon: number
  sigma: number
  mdvar: number
  reliability: number
  confidence: number
}

export interface PathAnalysis {
  distanceM: number
  stepM: number
  /** Antenna tops, metres above sea level. */
  topA: number
  topB: number
  /** Effective earth radius used for the curvature allowance, metres. */
  effectiveEarthM: number
  // Per-point series for the profile chart (all length np + 1).
  distKm: Float64Array
  ground: Float64Array
  /** Ground plus the earth-curvature bulge: what the radio path "sees". */
  groundCurved: Float64Array
  los: Float64Array
  /** Radius of the first Fresnel zone at each point, metres (0 at the antennas). */
  fresnelRadius: Float64Array
  /** Line of sight minus curved ground, metres; negative means the ground is in the way. */
  clearance: Float64Array
  // Summary
  losClear: boolean
  /** Index of the tightest point for the Fresnel zone, and of the point the ground rises highest into the line of sight. */
  tightestIndex: number
  blockingIndex: number
  /** Clearance at the tightest point as a share of the Fresnel radius there (can be negative or above 1). */
  tightestRatio: number
  /** 0–100: how much of the Fresnel radius is clear at the tightest point (0 when the line of sight is blocked). */
  fresnelClearPct: number
  // ITM
  itmCode: number
  pathLossDb: number
  mode: number
  warnings: number
}

/** Geometry (curvature, line of sight, Fresnel zone) and ITM path loss for a terrain profile. */
export function analyzePath(profile: TerrainProfile, heightA: number, heightB: number, radio: PathRadio): PathAnalysis {
  const np = profile.elevation.length - 1
  const d = profile.distanceM
  const stepM = d / np

  const pfl = new Float64Array(np + 3)
  pfl[0] = np
  pfl[1] = stepM
  pfl.set(profile.elevation, 2)
  const params: ItmParams = {
    hTx: heightA,
    hRx: heightB,
    climate: radio.climate,
    n0: radio.n0,
    fMhz: radio.fMhz,
    pol: radio.pol,
    epsilon: radio.epsilon,
    sigma: radio.sigma,
    mdvar: radio.mdvar,
    time: radio.reliability,
    location: 50,
    situation: radio.confidence,
  }
  const itm = itmP2PTls(params, pfl)
  const ok = itm.code < 1000

  // The same effective earth the model used, so the chart and the path loss agree about curvature.
  const effectiveEarthM = ok ? 1 / (157e-9 * (1 - 0.04665 * Math.exp(itm.nS / 179.3))) : K_FACTOR * EARTH_RADIUS_M

  const topA = profile.elevation[0] + heightA
  const topB = profile.elevation[np] + heightB
  const lambda = SPEED_OF_LIGHT_M_US / radio.fMhz

  const distKm = new Float64Array(np + 1)
  const ground = new Float64Array(np + 1)
  const groundCurved = new Float64Array(np + 1)
  const los = new Float64Array(np + 1)
  const fresnelRadius = new Float64Array(np + 1)
  const clearance = new Float64Array(np + 1)

  let tightestIndex = 0
  let tightestRatio = Infinity
  let blockingIndex = 0
  let blockingClearance = Infinity
  for (let i = 0; i <= np; i++) {
    const s = i * stepM
    distKm[i] = s / 1000
    ground[i] = profile.elevation[i]
    groundCurved[i] = ground[i] + (s * (d - s)) / (2 * effectiveEarthM)
    los[i] = topA + ((topB - topA) * s) / d
    fresnelRadius[i] = i === 0 || i === np ? 0 : Math.sqrt((lambda * s * (d - s)) / d)
    clearance[i] = los[i] - groundCurved[i]
    if (i > 0 && i < np) {
      const ratio = clearance[i] / fresnelRadius[i]
      if (ratio < tightestRatio) {
        tightestRatio = ratio
        tightestIndex = i
      }
      if (clearance[i] < blockingClearance) {
        blockingClearance = clearance[i]
        blockingIndex = i
      }
    }
  }
  if (!Number.isFinite(tightestRatio)) tightestRatio = Infinity

  return {
    distanceM: d,
    stepM,
    topA,
    topB,
    effectiveEarthM,
    distKm,
    ground,
    groundCurved,
    los,
    fresnelRadius,
    clearance,
    losClear: blockingClearance > 0,
    tightestIndex,
    blockingIndex,
    tightestRatio,
    fresnelClearPct: Math.max(0, Math.min(100, tightestRatio * 100)),
    itmCode: itm.code,
    pathLossDb: ok ? itm.lossDb : NaN,
    mode: itm.mode,
    warnings: itm.warnings,
  }
}

/** One way along a link: who transmits, what the receiver is, and what it needs to hear. */
export interface Direction {
  label: string
  budget: LinkBudget
  sensitivityDbm: number
}

export interface DirectionResult {
  label: string
  receivedDbm: number
  marginDb: number
  sensitivityDbm: number
  eirpDbm: number
}

export function evaluateDirection(path: PathAnalysis, dir: Direction): DirectionResult {
  const receivedDbm = receivedPowerDbm(dir.budget, path.pathLossDb)
  return {
    label: dir.label,
    receivedDbm,
    marginDb: receivedDbm - dir.sensitivityDbm,
    sensitivityDbm: dir.sensitivityDbm,
    eirpDbm: dir.budget.txPowerDbm + dir.budget.txGainDbi - dir.budget.txCableLossDb,
  }
}

export type Verdict = 'good' | 'marginal' | 'poor'

export interface Assessment {
  verdict: Verdict
  headline: string
  reasons: string[]
}

/**
 * A plain-language verdict. Rules of thumb, not guarantees: a link needs a positive margin in
 * every direction, ideally 10 dB or more to ride out fading and foliage, with the line of sight
 * clear and at least 60% of the first Fresnel zone free.
 */
export function assess(path: PathAnalysis, directions: DirectionResult[], mismatch: string | null): Assessment {
  const reasons: string[] = []
  if (mismatch) reasons.push(`Different radio settings: ${mismatch}. These two cannot hear each other.`)
  if (path.itmCode >= 1000) {
    reasons.push("The propagation model couldn't evaluate this path (an input is outside its limits).")
    return { verdict: 'poor', headline: 'Link could not be evaluated', reasons }
  }

  const margins = directions.map((d) => d.marginDb)
  const worst = Math.min(...margins)
  for (const d of directions) {
    const where = directions.length > 1 ? `${d.label}: ` : ''
    reasons.push(
      d.marginDb >= 0
        ? `${where}signal ${d.marginDb.toFixed(1)} dB above what the receiver needs${d.marginDb < GOOD_MARGIN_DB ? ' (under 10 dB leaves little room for fading or foliage)' : ''}`
        : `${where}signal ${Math.abs(d.marginDb).toFixed(1)} dB below what the receiver needs`,
    )
  }
  if (path.losClear) {
    reasons.push('Line of sight is clear')
  } else {
    const km = path.distKm[path.blockingIndex].toFixed(1)
    reasons.push(`Line of sight is blocked by ${Math.abs(path.clearance[path.blockingIndex]).toFixed(0)} m at ${km} km`)
  }
  if (path.losClear && path.fresnelClearPct < 100) {
    reasons.push(`First Fresnel zone is ${path.fresnelClearPct.toFixed(0)}% clear at its tightest point, ${path.distKm[path.tightestIndex].toFixed(1)} km along (60% or more is the usual aim)`)
  }

  let verdict: Verdict
  let headline: string
  if (mismatch || worst < 0) {
    verdict = 'poor'
    headline = mismatch ? 'Link not possible (different radio settings)' : 'Link unlikely (signal below receiver sensitivity)'
  } else if (worst >= GOOD_MARGIN_DB && path.losClear && path.fresnelClearPct >= GOOD_FRESNEL_PCT) {
    verdict = 'good'
    headline = 'Link looks good'
  } else {
    verdict = 'marginal'
    const why = !path.losClear ? 'line of sight blocked' : path.fresnelClearPct < GOOD_FRESNEL_PCT ? 'Fresnel zone obstructed' : 'low margin'
    headline = `Link marginal (${why})`
  }
  return { verdict, headline, reasons }
}

/**
 * The model's distance regime. This is not the same as whether the ground blocks the line of
 * sight: a ridge across a short path still counts as "inside the radio horizon" and shows up as
 * extra loss instead. Worded so it cannot be mistaken for the line-of-sight check.
 */
export const MODE_LABEL: Record<number, string> = {
  [PropMode.LINE_OF_SIGHT]: 'Inside the radio horizon',
  [PropMode.DIFFRACTION]: 'Beyond the radio horizon (diffraction)',
  [PropMode.TROPOSCATTER]: 'Far beyond the horizon (troposcatter)',
}

const WARNING_TEXT: [number, string][] = [
  [Warn.TX_TERMINAL_HEIGHT | Warn.RX_TERMINAL_HEIGHT, "An antenna height is outside the model's usual range (1–1000 m)."],
  [Warn.FREQUENCY, "The frequency is outside the model's usual range."],
  [Warn.PATH_DISTANCE_TOO_SMALL_1 | Warn.PATH_DISTANCE_TOO_SMALL_2, 'A very short path: the model is less reliable under about 1 km.'],
  [Warn.PATH_DISTANCE_TOO_BIG_1 | Warn.PATH_DISTANCE_TOO_BIG_2, 'A very long path: treat the result with care.'],
  [Warn.TX_HORIZON_ANGLE | Warn.RX_HORIZON_ANGLE, "A steep horizon angle: the model's approximations are less accurate."],
  [Warn.TX_HORIZON_DISTANCE_1 | Warn.RX_HORIZON_DISTANCE_1 | Warn.TX_HORIZON_DISTANCE_2 | Warn.RX_HORIZON_DISTANCE_2, 'Terrain close to an antenna gives an unusual horizon: treat the result with care.'],
  [Warn.EXTREME_VARIABILITIES, 'The reliability setting is far in the tail of the distribution.'],
  [Warn.SURFACE_REFRACTIVITY, 'Unusual surface refractivity at this height.'],
]

/** Human-readable text for the model's warning flags. */
export function describeWarnings(bits: number): string[] {
  return WARNING_TEXT.filter(([mask]) => (bits & mask) !== 0).map(([, text]) => text)
}

