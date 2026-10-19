import { describe, expect, it } from 'vitest'
import { gridGeometry, type CoverageResult } from '../src/engine/coverage'
import { AzimuthalEquidistant } from '../src/engine/geo'
import { cellSizeM, combineMargins, reachKm, readingsAt, summarizeMargins } from '../src/network'

const ORIGIN = { lat: 47, lng: 8 }
const proj = new AzimuthalEquidistant(ORIGIN)
const at = (xEast: number, yNorth: number) => {
  const ll = { lat: 0, lng: 0 }
  proj.inverse(xEast, yNorth, ll)
  return ll
}

/** A fake result on the standard 10 km-radius grid, filled by a function of east/north metres from ORIGIN. */
function fake(f: (x: number, y: number) => number, origin = ORIGIN): CoverageResult {
  const geom = gridGeometry(ORIGIN, 10_000, 500)
  const n = geom.n
  const data = new Float32Array(n * n)
  const p = { x: 0, y: 0 }
  const cell = cellSizeM(geom)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      // pixel centres, in metres east/north of ORIGIN (the grid is centred on it)
      const x = (col + 0.5 - n / 2) * cell
      const y = (n / 2 - row - 0.5) * cell
      p.x = x
      p.y = y
      data[row * n + col] = Math.hypot(x, y) <= 10_000 ? f(x, y) : NaN
    }
  }
  return { job: { origin, radiusM: 10_000 } as CoverageResult['job'], geom, data, missingTerrainLookups: 0, elapsedMs: 0 }
}

describe('combining nodes', () => {
  it('takes the best margin of any node at each pixel', () => {
    const a = Float32Array.from([-100, -120, NaN, NaN])
    const b = Float32Array.from([-110, -90, -105, NaN])
    const m = combineMargins([{ data: a, sensitivityDbm: -130 }, { data: b, sensitivityDbm: -130 }], 4)
    expect(Array.from(m).slice(0, 3)).toEqual([30, 40, 25])
    expect(Number.isNaN(m[3])).toBe(true)
  })

  it('compares margins, not raw signal, when nodes need different sensitivities', () => {
    // A hears -100 dBm but needs -127.5 (margin 27.5); B hears -105 but needs -131.5 (margin 26.5)
    const m = combineMargins([{ data: Float32Array.of(-100), sensitivityDbm: -127.5 }, { data: Float32Array.of(-105), sensitivityDbm: -131.5 }], 1)
    expect(m[0]).toBeCloseTo(27.5, 5)
    // and the reverse: B's lower sensitivity wins even though its raw signal is weaker
    const m2 = combineMargins([{ data: Float32Array.of(-100), sensitivityDbm: -110 }, { data: Float32Array.of(-105), sensitivityDbm: -131.5 }], 1)
    expect(m2[0]).toBeCloseTo(26.5, 5)
  })

  it('is NaN everywhere with no layers, and unchanged with one', () => {
    expect(Array.from(combineMargins([], 3)).every(Number.isNaN)).toBe(true)
    expect(Array.from(combineMargins([{ data: Float32Array.of(-100, NaN), sensitivityDbm: -130 }], 2)).map((v) => (Number.isNaN(v) ? 'nan' : v))).toEqual([30, 'nan'])
  })
})

describe('pixel size and summaries', () => {
  it('measures the pixel size on the ground', () => {
    const g = gridGeometry(ORIGIN, 10_000, 500)
    expect(cellSizeM(g)).toBeCloseTo(20_000 / g.n, 3)
  })

  it('counts covered area and share', () => {
    const r = fake(() => -121.5) // margin 10 dB everywhere inside the disc
    const m = combineMargins([{ data: r.data, sensitivityDbm: -131.5 }], r.data.length)
    const s = summarizeMargins(m, r.geom, 0)
    expect(s.coveredFraction).toBe(1)
    expect(s.maxMargin).toBeCloseTo(10, 4)
    const disc = Math.PI * 10 * 10
    expect(s.areaKm2).toBeGreaterThan(disc * 0.97)
    expect(s.areaKm2).toBeLessThan(disc * 1.03)
    expect(summarizeMargins(m, r.geom, 11).areaKm2).toBe(0)
  })

  it('works out reach from the node, not from the middle of the grid', () => {
    // signal only within 4 km of ORIGIN
    const near = fake((x, y) => (Math.hypot(x, y) <= 4_000 ? -100 : -200))
    expect(reachKm(near, -131.5)).toBeGreaterThan(3.8)
    expect(reachKm(near, -131.5)).toBeLessThan(4.4)
    // the same result but claimed to belong to a node 3 km east of the grid centre: reach is
    // measured from that node, so the far edge of the 4 km disc is now ~7 km from it
    const shifted = { ...near, job: { ...near.job, origin: at(3_000, 0) } }
    expect(reachKm(shifted, -131.5)).toBeGreaterThan(6.6)
    expect(reachKm(shifted, -131.5)).toBeLessThan(7.5)
    expect(reachKm(near, -90)).toBe(0) // a receiver needing -90 dBm hears nothing at -100
    expect(reachKm(near, -100)).toBeGreaterThan(3.8) // exactly 0 dB margin still counts as covered
  })
})

describe('readings at a point', () => {
  const a = fake((x) => -100 - x / 100) // gets weaker to the east
  const b = fake((x) => -110 + x / 100) // gets stronger to the east
  const sources = [
    { name: 'West', position: at(-8_000, 0), result: a, sensitivityDbm: -131.5 },
    { name: 'East', position: at(8_000, 0), result: b, sensitivityDbm: -131.5 },
  ]

  it('lists nodes strongest margin first, with distances', () => {
    const west = readingsAt(sources, at(-6_000, 0))
    expect(west.map((r) => r.name)).toEqual(['West', 'East'])
    expect(west[0].marginDb).toBeGreaterThan(west[1].marginDb)
    expect(west[0].distanceM).toBeGreaterThan(1_900)
    expect(west[0].distanceM).toBeLessThan(2_100)
    const east = readingsAt(sources, at(6_000, 0))
    expect(east.map((r) => r.name)).toEqual(['East', 'West'])
  })

  it('leaves out nodes that have no prediction there', () => {
    const only = fake((x, y) => (Math.hypot(x, y) < 1_000 ? -90 : NaN))
    const r = readingsAt([{ name: 'Tiny', position: ORIGIN, result: only, sensitivityDbm: -130 }, ...sources], at(5_000, 0))
    expect(r.map((x) => x.name)).not.toContain('Tiny')
    expect(readingsAt(sources, { lat: 10, lng: 10 })).toEqual([])
  })
})
