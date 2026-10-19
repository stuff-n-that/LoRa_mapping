// Turning a coverage result into pixels and numbers.
//
// The engine stores received power in dBm. What people care about is *margin*:
// how far above the receiver's sensitivity the signal is. Changing sensitivity,
// the minimum margin shown or the colour style only re-renders — nothing is recomputed.


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
  /** Pixels with less margin than this are left transparent. */
  minMargin: number
  mode: RenderMode
}

/** RGBA pixels for a grid of margins (dB over sensitivity), row 0 at the top. Transparent where there is nothing to show. */
export function renderMargins(margins: Float32Array, opts: RenderOptions): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(margins.length * 4)
  for (let i = 0; i < margins.length; i++) {
    const margin = margins[i]
    if (Number.isNaN(margin) || margin < opts.minMargin) continue
    const [r, g, b] = marginRgb(margin, opts.mode)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

/** Encode a margin grid (n x n) as a PNG object URL for a map image source. The caller revokes it. */
export async function renderToObjectUrl(margins: Float32Array, n: number, opts: RenderOptions): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D is not available')
  ctx.putImageData(new ImageData(renderMargins(margins, opts), n, n), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('could not encode the coverage image')
  return URL.createObjectURL(blob)
}
