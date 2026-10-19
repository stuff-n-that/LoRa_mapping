// Coverage prediction: for every pixel of an output raster, build the terrain
// profile from the transmitter and ask ITM for the path loss.

import { AzimuthalEquidistant, mercatorToLngLat, metersPerMercatorUnit, type LatLng } from './geo'
import { fspl } from './fspl'
import { itmP2PTls, newItmResult, type ItmParams } from './itm'
import { receivedPowerDbm, type LinkBudget } from './radio'
import { buildDem, demAt, TileElevation, type Dem } from './terrain'

export interface CoverageJob {
  origin: LatLng
  /** Transmitter and receiver heights above local ground, metres. */
  hTxM: number
  hRxM: number
  fMhz: number
  budget: LinkBudget
  radiusM: number
  /** Output pixel size on the ground, metres. */
  outCellM: number
  /** ITM variability: reliability maps to time (50 = median, 90 = conservative); confidence to situation. */
  reliability: number
  confidence: number
  climate: number
  n0: number
  pol: number
  epsilon: number
  sigma: number
  mdvar: number
  /** Terrain tile zoom and the DEM cell size derived from it, metres. */
  zoom: number
  demCellM: number
}

export interface GridGeometry {
  /** Pixels per side. */
  n: number
  /** Top-left corner in normalised Web Mercator, and the side length in the same units. */
  uMin: number
  vMin: number
  uSize: number
  /** [lng, lat] corners, clockwise from top-left, as MapLibre image sources expect. */
  corners: [[number, number], [number, number], [number, number], [number, number]]
}

export const MAX_GRID = 1024
export const MIN_GRID = 16
/** Upper bound on terrain samples per profile. */
export const MAX_PROFILE_POINTS = 600

export function gridGeometry(origin: LatLng, radiusM: number, outCellM: number): GridGeometry {
  const n = Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round((2 * radiusM) / outCellM)))
  const uSize = (2 * radiusM) / metersPerMercatorUnit(origin.lat)
  const cu = (origin.lng + 180) / 360
  const cv = 0.5 - Math.log(Math.tan(Math.PI / 4 + (origin.lat * Math.PI) / 360)) / (2 * Math.PI)
  const uMin = cu - uSize / 2
  const vMin = cv - uSize / 2
  const c = (u: number, v: number): [number, number] => {
    const ll = mercatorToLngLat(u, v)
    return [ll.lng, ll.lat]
  }
  return {
    n,
    uMin,
    vMin,
    uSize,
    corners: [c(uMin, vMin), c(uMin + uSize, vMin), c(uMin + uSize, vMin + uSize), c(uMin, vMin + uSize)],
  }
}

export interface CoverageContext {
  job: CoverageJob
  geom: GridGeometry
  dem: Dem
  proj: AzimuthalEquidistant
  params: ItmParams
  pfl: Float64Array
  itm: ReturnType<typeof newItmResult>
}

export function createContext(job: CoverageJob, dem: Dem): CoverageContext {
  return {
    job,
    geom: gridGeometry(job.origin, job.radiusM, job.outCellM),
    dem,
    proj: new AzimuthalEquidistant(job.origin),
    params: {
      hTx: job.hTxM,
      hRx: job.hRxM,
      climate: job.climate,
      n0: job.n0,
      fMhz: job.fMhz,
      pol: job.pol,
      epsilon: job.epsilon,
      sigma: job.sigma,
      mdvar: job.mdvar,
      time: job.reliability,
      location: 50,
      situation: job.confidence,
    },
    pfl: new Float64Array(MAX_PROFILE_POINTS + 3),
    itm: newItmResult(),
  }
}

/** Build the terrain profile (ITM PFL layout) from the transmitter to a point (x east, y north, metres). */
export function fillProfile(ctx: CoverageContext, x: number, y: number, d: number): void {
  const { dem, pfl } = ctx
  const np = Math.max(2, Math.min(MAX_PROFILE_POINTS, Math.ceil(d / dem.cellM)))
  pfl[0] = np
  pfl[1] = d / np
  for (let k = 0; k <= np; k++) {
    const t = k / np
    pfl[k + 2] = demAt(dem, x * t, y * t)
  }
}

/** Received signal in dBm at one point, or NaN when the model cannot produce a result. */
export function receivedAt(ctx: CoverageContext, x: number, y: number): number {
  const d = Math.hypot(x, y)
  const { job, dem } = ctx
  // Closer than a couple of terrain cells there is no usable profile: use free-space loss.
  if (d < 2 * dem.cellM) return receivedPowerDbm(job.budget, fspl(Math.max(d, dem.cellM), job.fMhz))
  fillProfile(ctx, x, y, d)
  const r = itmP2PTls(ctx.params, ctx.pfl, ctx.itm)
  if (r.code >= 1000) return NaN
  return receivedPowerDbm(job.budget, r.lossDb)
}

/** Compute one raster row (0 = north). Pixels outside the radius are NaN. */
export function computeRow(ctx: CoverageContext, row: number, out: Float32Array): void {
  const { geom, job, proj } = ctx
  const { n } = geom
  const v = geom.vMin + ((row + 0.5) / n) * geom.uSize
  const pt = { x: 0, y: 0 }
  for (let col = 0; col < n; col++) {
    const u = geom.uMin + ((col + 0.5) / n) * geom.uSize
    const ll = mercatorToLngLat(u, v)
    proj.forward(ll.lat, ll.lng, pt)
    if (Math.hypot(pt.x, pt.y) > job.radiusM) {
      out[col] = NaN
      continue
    }
    out[col] = receivedAt(ctx, pt.x, pt.y)
  }
}

export interface CoverageResult {
  job: CoverageJob
  geom: GridGeometry
  /** Received power in dBm, row-major, row 0 at the north edge; NaN outside the radius or where undefined. */
  data: Float32Array
  /** Terrain lookups that hit a missing tile (read as sea level). */
  missingTerrainLookups: number
  elapsedMs: number
}

/** Compute a whole result on the calling thread (used by tests and as a fallback). */
export function computeCoverageInline(job: CoverageJob, tiles: Map<string, Float32Array>): CoverageResult {
  const t0 = performance.now()
  const source = new TileElevation(job.zoom, tiles)
  const dem = buildDem(source, job.origin, job.radiusM, job.demCellM)
  const ctx = createContext(job, dem)
  const n = ctx.geom.n
  const data = new Float32Array(n * n)
  const row = new Float32Array(n)
  for (let r = 0; r < n; r++) {
    computeRow(ctx, r, row)
    data.set(row, r * n)
  }
  return { job, geom: ctx.geom, data, missingTerrainLookups: source.missingLookups, elapsedMs: performance.now() - t0 }
}

/** Nearest-pixel lookup of the received power at a map position; NaN outside the raster. */
export function sampleResult(result: CoverageResult, lat: number, lng: number): number {
  const { geom } = result
  const u = (lng + 180) / 360
  const v = 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
  const col = Math.floor(((u - geom.uMin) / geom.uSize) * geom.n)
  const row = Math.floor(((v - geom.vMin) / geom.uSize) * geom.n)
  if (col < 0 || row < 0 || col >= geom.n || row >= geom.n) return NaN
  return result.data[row * geom.n + col]
}
