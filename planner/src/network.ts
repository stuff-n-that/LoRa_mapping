// Combining the results of several nodes into one view of the network.
//
// Every node is computed onto the same raster, as received power in dBm. What matters to a user is
// the *margin* over the receiver's sensitivity, and different nodes can use different radio settings
// (so different sensitivities). At each pixel the network margin is the best margin of any node:
// a receiver there would join whichever node it hears best.

import type { CoverageResult, GridGeometry } from './engine/coverage'
import { sampleResult } from './engine/coverage'
import { haversineM, lngLatToMercator, mercatorToLngLat, metersPerMercatorUnit, type LatLng } from './engine/geo'

export interface Layer {
  /** Received power in dBm on the shared raster; NaN where this node has no result. */
  data: Float32Array
  /** The sensitivity this node's receivers need, dBm. */
  sensitivityDbm: number
}

/** A computed node, kept with the key of the job that produced it so stale results can be spotted. */
export interface NodeResult {
  id: string
  name: string
  key: string
  result: CoverageResult
}

export interface NetworkResult {
  nodes: NodeResult[]
  elapsedMs: number
}

/** Best margin over sensitivity at each pixel, dB; NaN where no node has a result. */
export function combineMargins(layers: Layer[], pixels: number): Float32Array {
  const out = new Float32Array(pixels).fill(NaN)
  for (const layer of layers) {
    const { data, sensitivityDbm } = layer
    for (let i = 0; i < pixels; i++) {
      const p = data[i]
      if (Number.isNaN(p)) continue
      const margin = p - sensitivityDbm
      if (!(margin <= out[i])) out[i] = margin // also true when out[i] is NaN
    }
  }
  return out
}

/** Ground metres across one pixel of a raster. */
export function cellSizeM(geom: GridGeometry): number {
  const centre = mercatorToLngLat(geom.uMin + geom.uSize / 2, geom.vMin + geom.uSize / 2)
  return (geom.uSize * metersPerMercatorUnit(centre.lat)) / geom.n
}

export interface MarginSummary {
  /** Area with at least `minMargin` dB of margin, km². */
  areaKm2: number
  /** Share of the defined pixels (by count) that are covered, 0..1. */
  coveredFraction: number
  /** Strongest margin seen, dB. */
  maxMargin: number
}

export function summarizeMargins(margins: Float32Array, geom: GridGeometry, minMargin = 0): MarginSummary {
  const cell = cellSizeM(geom)
  let covered = 0
  let defined = 0
  let maxMargin = -Infinity
  for (let i = 0; i < margins.length; i++) {
    const m = margins[i]
    if (Number.isNaN(m)) continue
    defined++
    if (m > maxMargin) maxMargin = m
    if (m >= minMargin) covered++
  }
  return {
    areaKm2: (covered * cell * cell) / 1e6,
    coveredFraction: defined ? covered / defined : 0,
    maxMargin: Number.isFinite(maxMargin) ? maxMargin : 0,
  }
}

/** Furthest distance from the node at which a pixel still has at least `minMargin`, km. */
export function reachKm(result: CoverageResult, sensitivityDbm: number, minMargin = 0): number {
  const { geom } = result
  const { n } = geom
  const o = lngLatToMercator(result.job.origin.lng, result.job.origin.lat)
  const cx = ((o.u - geom.uMin) / geom.uSize) * n - 0.5
  const cy = ((o.v - geom.vMin) / geom.uSize) * n - 0.5
  let far = 0
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const prx = result.data[row * n + col]
      if (Number.isNaN(prx) || prx - sensitivityDbm < minMargin) continue
      const d = Math.hypot(col - cx, row - cy)
      if (d > far) far = d
    }
  }
  return (far * cellSizeM(geom)) / 1000
}

export interface Reading {
  name: string
  prxDbm: number
  marginDb: number
  distanceM: number
}

export interface ReadingSource {
  name: string
  position: LatLng
  result: CoverageResult
  sensitivityDbm: number
}

/** What each node predicts at a point, strongest margin first. Nodes with no prediction there are left out. */
export function readingsAt(sources: ReadingSource[], point: LatLng): Reading[] {
  const out: Reading[] = []
  for (const s of sources) {
    const prx = sampleResult(s.result, point.lat, point.lng)
    if (Number.isNaN(prx)) continue
    out.push({ name: s.name, prxDbm: prx, marginDb: prx - s.sensitivityDbm, distanceM: haversineM(s.position, point) })
  }
  return out.sort((a, b) => b.marginDb - a.marginDb)
}
