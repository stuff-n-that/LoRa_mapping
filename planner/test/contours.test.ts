import { describe, expect, it } from 'vitest'
import { contourLines } from '../src/contours'
import { gridGeometry } from '../src/engine/coverage'
import { lngLatToMercator } from '../src/engine/geo'

const geom = gridGeometry({ lat: 47, lng: 8 }, 10_000, 250) // 80 x 80
const n = geom.n

/** Back from lng/lat to the raster's pixel-edge coordinates (pixel (c, r) spans [c, c+1] x [r, r+1]). */
function toPixels([lng, lat]: number[]): [number, number] {
  const { u, v } = lngLatToMercator(lng, lat)
  return [((u - geom.uMin) / geom.uSize) * n, ((v - geom.vMin) / geom.uSize) * n]
}

/** margin = radius - distance from the middle, in pixels: a cone, so level L is a circle of radius (radius - L). */
function cone(radius: number, cx = n / 2, cy = n / 2): Float32Array {
  const out = new Float32Array(n * n)
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) out[row * n + col] = radius - Math.hypot(col + 0.5 - cx, row + 0.5 - cy)
  return out
}

describe('contour lines', () => {
  it('draws each level as a ring at the right radius and place', () => {
    const fc = contourLines(geom, cone(30), [0, 10, 20])
    expect(fc.features.map((f) => f.properties.level)).toEqual([0, 10, 20])
    for (const f of fc.features) {
      const expected = 30 - f.properties.level
      expect(f.geometry.coordinates.length).toBe(1) // one closed ring
      for (const ring of f.geometry.coordinates) {
        expect(ring.length).toBeGreaterThan(20)
        for (const pt of ring) {
          const [x, y] = toPixels(pt)
          expect(Math.hypot(x - n / 2, y - n / 2)).toBeCloseTo(expected, 0)
          expect(Math.abs(Math.hypot(x - n / 2, y - n / 2) - expected)).toBeLessThan(0.25)
        }
      }
    }
  })

  it('closes around coverage that runs to the edge of the raster, instead of leaving it open', () => {
    const wide = cone(60) // spills well past the 40-pixel half-width
    const fc = contourLines(geom, wide, [0])
    const rings = fc.features[0].geometry.coordinates
    for (const ring of rings) {
      expect(ring[0]).toEqual(ring[ring.length - 1])
      for (const pt of ring) {
        const [x, y] = toPixels(pt)
        expect(x).toBeGreaterThanOrEqual(-0.51)
        expect(x).toBeLessThanOrEqual(n + 0.51)
        expect(y).toBeGreaterThanOrEqual(-0.51)
        expect(y).toBeLessThanOrEqual(n + 0.51)
      }
    }
  })

  it('treats NaN as no coverage, so a disc of NaN-surrounded values is outlined at its own edge', () => {
    const m = cone(30)
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (Math.hypot(col + 0.5 - n / 2, row + 0.5 - n / 2) > 25) m[row * n + col] = NaN
    const fc = contourLines(geom, m, [0])
    for (const pt of fc.features[0].geometry.coordinates[0]) {
      const [x, y] = toPixels(pt)
      expect(Math.hypot(x - n / 2, y - n / 2)).toBeLessThan(26.5)
      expect(Math.hypot(x - n / 2, y - n / 2)).toBeGreaterThan(23.5)
    }
  })

  it('gives an empty line set where nothing reaches a level, and handles an empty grid', () => {
    const fc = contourLines(geom, cone(10), [0, 15])
    expect(fc.features.find((f) => f.properties.level === 15)?.geometry.coordinates.length).toBe(0)
    const none = contourLines(geom, new Float32Array(n * n).fill(NaN), [0, 6])
    expect(none.features.every((f) => f.geometry.coordinates.length === 0)).toBe(true)
  })
})
