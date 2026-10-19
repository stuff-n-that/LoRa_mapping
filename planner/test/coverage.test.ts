import { describe, expect, it } from 'vitest'
import {
  computeCoverageInline,
  createContext,
  discRows,
  fillProfile,
  gridGeometry,
  MAX_GRID,
  receivedAt,
  sampleResult,
  unionGrid,
  type CoverageJob,
} from '../src/engine/coverage'
import { fspl } from '../src/engine/fspl'
import { AzimuthalEquidistant, haversineM, mercatorToLngLat } from '../src/engine/geo'
import { itmP2PTls } from '../src/engine/itm'
import { receivedPowerDbm, type LinkBudget } from '../src/engine/radio'
import { buildDem, demAt, TILE_SIZE, TileElevation, tilesCovering } from '../src/engine/terrain'

const ORIGIN = { lat: 47, lng: 8 }
const Z = 10
const N_WORLD = TILE_SIZE * 2 ** Z

const budget: LinkBudget = { txPowerDbm: 22, txGainDbi: 2, txCableLossDb: 0.5, rxGainDbi: 2, rxCableLossDb: 0, extraLossDb: 0 }

function job(over: Partial<CoverageJob> = {}): CoverageJob {
  return {
    origin: ORIGIN,
    hTxM: 10,
    hRxM: 2,
    fMhz: 915,
    budget,
    radiusM: 12_000,
    outCellM: 400,
    reliability: 50,
    confidence: 50,
    climate: 5,
    n0: 301,
    pol: 1,
    epsilon: 15,
    sigma: 0.005,
    mdvar: 3,
    zoom: Z,
    demCellM: 100,
    ...over,
  }
}

/** Build tiles for the area from a function of local east/north metres. */
function tilesFor(radiusM: number, elevation: (xEast: number, yNorth: number) => number): Map<string, Float32Array> {
  const proj = new AzimuthalEquidistant(ORIGIN)
  const tiles = new Map<string, Float32Array>()
  const p = { x: 0, y: 0 }
  for (const k of tilesCovering(ORIGIN, radiusM * 1.3, Z)) {
    const a = new Float32Array(TILE_SIZE * TILE_SIZE)
    for (let y = 0; y < TILE_SIZE; y++) {
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (k.y * TILE_SIZE + y + 0.5)) / N_WORLD))) * 180) / Math.PI
      for (let x = 0; x < TILE_SIZE; x++) {
        const lng = ((k.x * TILE_SIZE + x + 0.5) / N_WORLD) * 360 - 180
        proj.forward(lat, lng, p)
        a[y * TILE_SIZE + x] = elevation(p.x, p.y)
      }
    }
    tiles.set(`${k.x}/${k.y}`, a)
  }
  return tiles
}

function at(result: ReturnType<typeof computeCoverageInline>, xEast: number, yNorth: number): number {
  const proj = new AzimuthalEquidistant(ORIGIN)
  const ll = { lat: 0, lng: 0 }
  proj.inverse(xEast, yNorth, ll)
  return sampleResult(result, ll.lat, ll.lng)
}

describe('raster geometry', () => {
  it('is centred on the transmitter and sized to the radius', () => {
    const g = gridGeometry(ORIGIN, 12_000, 400)
    expect(g.n).toBe(60)
    const centre = mercatorToLngLat(g.uMin + g.uSize / 2, g.vMin + g.uSize / 2)
    expect(centre.lat).toBeCloseTo(ORIGIN.lat, 6)
    expect(centre.lng).toBeCloseTo(ORIGIN.lng, 6)
    // the raster is (about) 2R wide on the ground, west to east through the centre
    const [tl, tr] = g.corners
    expect(haversineM({ lat: tl[1], lng: tl[0] }, { lat: tr[1], lng: tr[0] })).toBeGreaterThan(23_800)
    expect(haversineM({ lat: tl[1], lng: tl[0] }, { lat: tr[1], lng: tr[0] })).toBeLessThan(24_200)
  })
  it('caps the pixel count', () => {
    expect(gridGeometry(ORIGIN, 50_000, 10).n).toBe(1024)
    expect(gridGeometry(ORIGIN, 500, 5000).n).toBe(16)
  })
})

describe('coverage on flat ground', () => {
  const tiles = tilesFor(12_000, () => 300)
  const result = computeCoverageInline(job(), tiles)

  it('is NaN outside the radius and finite inside', () => {
    expect(Number.isNaN(at(result, 14_000, 0))).toBe(true)
    expect(Number.isFinite(at(result, 6_000, 0))).toBe(true)
    expect(Number.isFinite(at(result, 0, -6_000))).toBe(true)
  })

  it('uses plain free-space loss right next to the transmitter', () => {
    const near = at(result, 300, 0)
    expect(near).toBeGreaterThan(receivedPowerDbm(budget, fspl(900, 915)))
    expect(near).toBeLessThan(receivedPowerDbm(budget, fspl(150, 915)))
  })

  it('fades with distance and is roughly the same in every direction', () => {
    const e = at(result, 9_000, 0)
    const w = at(result, -9_000, 0)
    const n = at(result, 0, 9_000)
    const s = at(result, 0, -9_000)
    const closeE = at(result, 3_000, 0)
    expect(closeE).toBeGreaterThan(e + 8)
    for (const v of [w, n, s]) expect(Math.abs(v - e)).toBeLessThan(3)
  })

  it('produces no missing-terrain lookups when all tiles are present', () => {
    expect(result.missingTerrainLookups).toBe(0)
  })
})

describe('cautious planning', () => {
  it('lowers the predicted signal by roughly 10 dB at distance (confidence, not just time)', () => {
    const tiles = tilesFor(12_000, () => 300)
    const typical = computeCoverageInline(job({ reliability: 50, confidence: 50 }), tiles)
    const cautious = computeCoverageInline(job({ reliability: 90, confidence: 90 }), tiles)
    const drop = at(typical, 8_000, 0) - at(cautious, 8_000, 0)
    expect(drop).toBeGreaterThan(7)
    expect(drop).toBeLessThan(13)
  })
})

describe('coverage behind a ridge', () => {
  // A 350 m high ridge about 4 km east of the transmitter, running north-south.
  const ridge = (x: number) => 300 + 350 * Math.exp(-(((x - 4000) / 350) ** 2))
  const tiles = tilesFor(12_000, (x) => ridge(x))
  const result = computeCoverageInline(job(), tiles)
  const flat = computeCoverageInline(job(), tilesFor(12_000, () => 300))

  it('casts a radio shadow on the far side only', () => {
    const behind = at(result, 8_000, 0)
    const sameDistanceWest = at(result, -8_000, 0)
    const flatEast = at(flat, 8_000, 0)
    expect(behind).toBeLessThan(sameDistanceWest - 10)
    expect(behind).toBeLessThan(flatEast - 10)
    // unaffected side matches flat ground
    expect(Math.abs(sameDistanceWest - at(flat, -8_000, 0))).toBeLessThan(1)
    // in front of the ridge is unaffected too
    expect(Math.abs(at(result, 2_000, 0) - at(flat, 2_000, 0))).toBeLessThan(2)
  })
})

describe('profile construction', () => {
  it('matches a hand-built ITM call for the same path', () => {
    const tiles = tilesFor(12_000, (x, y) => 300 + 0.02 * x + 0.01 * y + 40 * Math.sin(x / 700))
    const j = job()
    const dem = buildDem(new TileElevation(Z, tiles), ORIGIN, j.radiusM, j.demCellM)
    const ctx = createContext(j, dem)
    const x = 7_000
    const y = 3_000
    const d = Math.hypot(x, y)
    const viaEngine = receivedAt(ctx, x, y)

    const np = Math.ceil(d / j.demCellM)
    const pfl = new Float64Array(np + 3)
    pfl[0] = np
    pfl[1] = d / np
    for (let k = 0; k <= np; k++) pfl[k + 2] = demAt(dem, (x * k) / np, (y * k) / np)
    const r = itmP2PTls({ ...ctx.params }, pfl)
    expect(r.code).toBeLessThan(1000)
    expect(viaEngine).toBeCloseTo(receivedPowerDbm(budget, r.lossDb), 9)

    fillProfile(ctx, x, y, d)
    expect(ctx.pfl[0]).toBe(np)
    expect(ctx.pfl[2]).toBeCloseTo(dem.data[dem.centre * dem.size + dem.centre], 5)
  })

  it('maps raster pixels back to the same pixel', () => {
    const j = job({ radiusM: 6_000, outCellM: 300 })
    const result = computeCoverageInline(j, tilesFor(6_000, () => 250))
    const g = result.geom
    for (const [row, col] of [[3, 3], [10, 20], [19, 5], [g.n - 1, g.n - 1]]) {
      const ll = mercatorToLngLat(g.uMin + ((col + 0.5) / g.n) * g.uSize, g.vMin + ((row + 0.5) / g.n) * g.uSize)
      const v = sampleResult(result, ll.lat, ll.lng)
      const stored = result.data[row * g.n + col]
      if (Number.isNaN(stored)) expect(Number.isNaN(v)).toBe(true)
      else expect(v).toBe(stored)
    }
    expect(Number.isNaN(sampleResult(result, ORIGIN.lat + 1, ORIGIN.lng))).toBe(true)
  })
})


describe('shared grid for several nodes', () => {
  const proj = new AzimuthalEquidistant(ORIGIN)
  const at2 = (xEast: number, yNorth: number) => {
    const ll = { lat: 0, lng: 0 }
    proj.inverse(xEast, yNorth, ll)
    return ll
  }

  it('is identical to the single-node grid when there is one node', () => {
    const one = unionGrid([ORIGIN], 12_000, 400)
    const plain = gridGeometry(ORIGIN, 12_000, 400)
    expect(one.n).toBe(plain.n)
    expect(one.uMin).toBeCloseTo(plain.uMin, 12)
    expect(one.vMin).toBeCloseTo(plain.vMin, 12)
    expect(one.uSize).toBeCloseTo(plain.uSize, 12)
  })

  it('covers every node disc and grows with the spread', () => {
    const a = ORIGIN
    const b = at2(15_000, 9_000)
    const grid = unionGrid([a, b], 6_000, 300)
    const single = gridGeometry(a, 6_000, 300)
    expect(grid.uSize).toBeGreaterThan(single.uSize * 1.9)
    for (const o of [a, b]) {
      for (const [dx, dy] of [[-6000, 0], [6000, 0], [0, -6000], [0, 6000]]) {
        const p = new AzimuthalEquidistant(o)
        const ll = { lat: 0, lng: 0 }
        p.inverse(dx, dy, ll)
        const u = (ll.lng + 180) / 360
        const v = 0.5 - Math.log(Math.tan(Math.PI / 4 + (ll.lat * Math.PI) / 360)) / (2 * Math.PI)
        expect(u).toBeGreaterThanOrEqual(grid.uMin - 1e-9)
        expect(u).toBeLessThanOrEqual(grid.uMin + grid.uSize + 1e-9)
        expect(v).toBeGreaterThanOrEqual(grid.vMin - 1e-9)
        expect(v).toBeLessThanOrEqual(grid.vMin + grid.uSize + 1e-9)
      }
    }
  })

  it('caps the pixel count, and refuses nodes that are absurdly far apart', () => {
    expect(unionGrid([ORIGIN, at2(300_000, 0)], 20_000, 50).n).toBe(MAX_GRID)
    expect(() => unionGrid([ORIGIN, at2(600_000, 0)], 20_000, 150)).toThrow(/too far apart/)
    expect(() => unionGrid([], 1000, 100)).toThrow(RangeError)
  })

  it('puts each node on the same raster, with NaN outside its own disc', () => {
    const radius = 6_000
    const bPos = at2(8_000, 0)
    const grid = unionGrid([ORIGIN, bPos], radius, 300)
    const tiles = tilesFor(22_000, () => 300)
    const jobA = job({ radiusM: radius, outCellM: 300, grid })
    const jobB = job({ origin: bPos, radiusM: radius, outCellM: 300, grid })
    const ra = computeCoverageInline(jobA, tiles)
    const rb = computeCoverageInline(jobB, tiles)
    expect(ra.geom).toEqual(grid)
    expect(rb.geom).toEqual(grid)
    expect(ra.data.length).toBe(rb.data.length)

    const value = (r: typeof ra, ll: { lat: number; lng: number }) => sampleResult(r, ll.lat, ll.lng)
    // A's own transmitter area is strong for A and outside B's disc
    expect(Number.isFinite(value(ra, at2(1_000, 0)))).toBe(true)
    expect(Number.isNaN(value(rb, at2(1_000, 0)))).toBe(true)
    // B's neighbourhood: the reverse
    expect(Number.isFinite(value(rb, at2(9_000, 0)))).toBe(true)
    expect(Number.isNaN(value(ra, at2(9_000, 0)))).toBe(true)
    // the overlap between the nodes is defined for both
    expect(Number.isFinite(value(ra, at2(4_000, 0)))).toBe(true)
    expect(Number.isFinite(value(rb, at2(4_000, 0)))).toBe(true)
  })

  it('only computes rows the disc can touch, and every finite pixel lies inside them', () => {
    const radius = 6_000
    const bPos = at2(0, 20_000)
    const grid = unionGrid([ORIGIN, bPos], radius, 300)
    const [first, last] = discRows(grid, ORIGIN, radius)
    // B is 20 km north of A, so the top of the grid (B's end) is rows A never touches;
    // A's own disc reaches the bottom edge, which is the south end of the grid.
    expect(first).toBeGreaterThan(grid.n / 3)
    expect(last).toBe(grid.n - 1)
    const ra = computeCoverageInline(job({ radiusM: radius, outCellM: 300, grid }), tilesFor(30_000, () => 300))
    let finite = 0
    for (let row = 0; row < grid.n; row++) {
      for (let col = 0; col < grid.n; col++) {
        if (Number.isFinite(ra.data[row * grid.n + col])) {
          finite++
          expect(row).toBeGreaterThanOrEqual(first)
          expect(row).toBeLessThanOrEqual(last)
        }
      }
    }
    // roughly the area of the disc, in pixels
    const cell = (2 * radius) / gridGeometry(ORIGIN, radius, 300).n
    expect(finite * cell * cell).toBeGreaterThan(Math.PI * radius * radius * 0.9)
    expect(finite * cell * cell).toBeLessThan(Math.PI * radius * radius * 1.1)
  })

  it('gives the same values with and without an explicit grid when there is one node', () => {
    const tiles = tilesFor(12_000, (x) => 300 + 40 * Math.sin(x / 900))
    const a = computeCoverageInline(job(), tiles)
    const b = computeCoverageInline(job({ grid: gridGeometry(ORIGIN, 12_000, 400) }), tiles)
    expect(b.data).toEqual(a.data)
  })
})
