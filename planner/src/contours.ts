// Lines on the map where the signal margin crosses a level (the edges of the colour bands).

import { contours as d3Contours } from 'd3-contour'
import type { FeatureCollection, MultiLineString } from 'geojson'
import type { GridGeometry } from './engine/coverage'
import { mercatorToLngLat } from './engine/geo'

/** Below any real margin; stands in for "no coverage here" so lines close around the covered area. */
const NOTHING = -1000

export interface ContourProps {
  level: number
}

/**
 * Closed lines (as lng/lat) where the margin grid crosses each level.
 *
 * `margins` is n x n, row 0 at the top, NaN where there is no result. The grid is padded with a
 * border of "nothing" so a covered area that reaches the edge of the raster is still outlined,
 * and positions are interpolated between pixel centres.
 */
export function contourLines(geom: GridGeometry, margins: Float32Array, levels: number[]): FeatureCollection<MultiLineString, ContourProps> {
  const n = geom.n
  const w = n + 2
  const padded = new Float64Array(w * w).fill(NOTHING)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const m = margins[row * n + col]
      padded[(row + 1) * w + col + 1] = Number.isNaN(m) ? NOTHING : m
    }
  }
  const rings = d3Contours().size([w, w]).thresholds([...levels].sort((a, b) => a - b))(padded as unknown as number[])

  const toLngLat = (x: number, y: number): [number, number] => {
    // d3 gives pixel-edge coordinates of the padded grid; take off the one-pixel border
    const ll = mercatorToLngLat(geom.uMin + ((x - 1) / n) * geom.uSize, geom.vMin + ((y - 1) / n) * geom.uSize)
    return [ll.lng, ll.lat]
  }

  return {
    type: 'FeatureCollection',
    features: rings.map((shape) => ({
      type: 'Feature',
      properties: { level: shape.value },
      geometry: {
        type: 'MultiLineString',
        coordinates: shape.coordinates.flatMap((polygon) => polygon.map((ring) => ring.map(([x, y]) => toLngLat(x, y)))),
      },
    })),
  }
}
