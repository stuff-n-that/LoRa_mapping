// Turning a coverage result into pixels and numbers.
//
// The engine stores received power in dBm. What people care about is *margin*:
// how far above the receiver's sensitivity the signal is. Changing sensitivity,
// the minimum margin shown or the colour style only re-renders — nothing is recomputed.

import type { CoverageResult } from './engine/coverage'

export type RenderMode = 'smooth' | 'bands'

export interface MarginBand {
  /** Lower edge, dB above sensitivity. */
  from: number
  label: string
  color: string
}

/** Bands used for the legend and the "bands" style. Smooth style interpolates between the same colours. */
export const MARGIN_BANDS: MarginBand[] = [
  { from: 0, label: 'Marginal (0–6 dB)', color: '#7b3294' },
  { from: 6, label: 'Fair (6–12 dB)', color: '#3a7bd5' },
  { from: 12, label: 'Good (12–20 dB)', color: '#2ec4b6' },
  { from: 20, label: 'Strong (20–30 dB)', color: '#9be15d' },
  { from: 30, label: 'Very strong (30+ dB)', color: '#f9f871' },
]

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const BAND_RGB = MARGIN_BANDS.map((b) => hex(b.color))
// Colour stops for the smooth ramp sit in the middle of each band; the last band saturates.
const STOPS = [0, 9, 16, 25, 36]

export function marginRgb(margin: number, mode: RenderMode): [number, number, number] {
  if (mode === 'bands') {
    let i = 0
    for (let b = 0; b < MARGIN_BANDS.length; b++) if (margin >= MARGIN_BANDS[b].from) i = b
    return BAND_RGB[i]
  }
  if (margin <= STOPS[0]) return BAND_RGB[0]
  for (let i = 1; i < STOPS.length; i++) {
    if (margin <= STOPS[i]) {
      const t = (margin - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1])
      const a = BAND_RGB[i - 1]
      const b = BAND_RGB[i]
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    }
  }
  return BAND_RGB[BAND_RGB.length - 1]
}

export interface RenderOptions {
  sensitivityDbm: number
  /** Pixels with less margin than this are left transparent. */
  minMargin: number
  mode: RenderMode
}

/** RGBA pixels for the raster, row 0 at the top. Transparent where there is no coverage to show. */
export function renderRgba(result: CoverageResult, opts: RenderOptions): Uint8ClampedArray<ArrayBuffer> {
  const { n } = result.geom
  const out = new Uint8ClampedArray(n * n * 4)
  const { data } = result
  for (let i = 0; i < data.length; i++) {
    const prx = data[i]
    if (Number.isNaN(prx)) continue
    const margin = prx - opts.sensitivityDbm
    if (margin < opts.minMargin) continue
    const [r, g, b] = marginRgb(margin, opts.mode)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

/** Encode the raster as a PNG object URL for a map image source. The caller revokes it. */
export async function renderToObjectUrl(result: CoverageResult, opts: RenderOptions): Promise<string> {
  const { n } = result.geom
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D is not available')
  ctx.putImageData(new ImageData(renderRgba(result, opts), n, n), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('could not encode the coverage image')
  return URL.createObjectURL(blob)
}

export interface Summary {
  /** Area with at least `minMargin` dB of margin, km². */
  areaKm2: number
  /** Furthest pixel centre with coverage from the transmitter, km. */
  reachKm: number
  /** Share of the circle (by area) that is covered, 0..1. */
  coveredFraction: number
  /** Strongest and weakest margin seen, dB. */
  maxMargin: number
}

export function summarize(result: CoverageResult, sensitivityDbm: number, minMargin = 0): Summary {
  const { n } = result.geom
  const cellM = (2 * result.job.radiusM) / n
  const c = (n - 1) / 2
  let covered = 0
  let inside = 0
  let reachCells = 0
  let maxMargin = -Infinity
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const prx = result.data[row * n + col]
      if (Number.isNaN(prx)) continue
      inside++
      const margin = prx - sensitivityDbm
      if (margin > maxMargin) maxMargin = margin
      if (margin < minMargin) continue
      covered++
      const dist = Math.hypot(col - c, row - c)
      if (dist > reachCells) reachCells = dist
    }
  }
  return {
    areaKm2: (covered * cellM * cellM) / 1e6,
    reachKm: (reachCells * cellM) / 1000,
    coveredFraction: inside ? covered / inside : 0,
    maxMargin: Number.isFinite(maxMargin) ? maxMargin : 0,
  }
}
