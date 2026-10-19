import { describe, expect, it } from 'vitest'
import { haversineM, type LatLng } from '../src/engine/geo'
import { itmP2PTls } from '../src/engine/itm'
import {
  GOOD_MARGIN_DB,
  MAX_LINK_POINTS,
  analyzePath,
  assess,
  describeWarnings,
  evaluateDirection,
  pointAlongPath,
  sampleProfile,
  type PathRadio,
  type TerrainProfile,
} from '../src/engine/link'
import { linkZoom, tilesAlongPath, trimCache } from '../src/engine/terrain'

const A: LatLng = { lat: 47, lng: 8 }
const radio: PathRadio = { fMhz: 915, climate: 5, n0: 301, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, reliability: 50, confidence: 50 }
const budget = { txPowerDbm: 22, txGainDbi: 2, txCableLossDb: 0.5, rxGainDbi: 2, rxCableLossDb: 0, extraLossDb: 0 }

/** A profile of `np` steps over `distanceM`, elevation from a function of the distance fraction. */
function profile(distanceM: number, np: number, f: (t: number) => number): TerrainProfile {
  const elevation = new Float64Array(np + 1)
  for (let i = 0; i <= np; i++) elevation[i] = f(i / np)
  return { distanceM, elevation }
}

describe('sampling terrain along a path', () => {
  it('samples evenly between the two ends', () => {
    const b = { lat: 47, lng: 8.2 }
    const p = sampleProfile({ sample: (_lat, lng) => 100 + 1000 * (lng - 8) }, A, b, 100)
    expect(p.distanceM).toBeCloseTo(haversineM(A, b), 0)
    expect(p.elevation.length).toBe(Math.round(p.distanceM / 100) + 1)
    expect(p.elevation[0]).toBeCloseTo(100, 6)
    expect(p.elevation[p.elevation.length - 1]).toBeCloseTo(300, 4)
    // rises steadily eastwards
    for (let i = 1; i < p.elevation.length; i++) expect(p.elevation[i]).toBeGreaterThan(p.elevation[i - 1])
  })

  it('never takes more than the maximum number of samples, and at least a few', () => {
    expect(sampleProfile({ sample: () => 1 }, A, { lat: 47, lng: 12 }, 10).elevation.length).toBe(MAX_LINK_POINTS + 1)
    expect(sampleProfile({ sample: () => 1 }, A, { lat: 47, lng: 8.0001 }, 100).elevation.length).toBe(3)
  })

  it('finds the point a fraction of the way along', () => {
    const b = { lat: 47.2, lng: 8.3 }
    const start = pointAlongPath(A, b, 0)
    const mid = pointAlongPath(A, b, 0.5)
    const end = pointAlongPath(A, b, 1)
    expect(haversineM(start, A)).toBeLessThan(0.01)
    expect(haversineM(end, b)).toBeLessThan(0.01)
    expect(haversineM(A, mid)).toBeCloseTo(haversineM(mid, b), 0)
  })
})

describe('path geometry', () => {
  const flat = profile(10_000, 100, () => 300)

  it('allows for the curve of the earth, most at the middle', () => {
    const p = analyzePath(flat, 10, 2, radio)
    expect(p.effectiveEarthM).toBeGreaterThan(7.5e6)
    expect(p.effectiveEarthM).toBeLessThan(9.5e6)
    const mid = 50
    expect(p.groundCurved[mid] - p.ground[mid]).toBeCloseTo((5000 * 5000) / (2 * p.effectiveEarthM), 6)
    expect(p.groundCurved[0]).toBe(300)
    expect(p.groundCurved[100]).toBe(300)
  })

  it('sizes the first Fresnel zone from the wavelength', () => {
    const p = analyzePath(flat, 10, 2, radio)
    const lambda = 299.792458 / 915
    expect(p.fresnelRadius[50]).toBeCloseTo(Math.sqrt((lambda * 5000 * 5000) / 10_000), 6)
    expect(p.fresnelRadius[0]).toBe(0)
    expect(p.fresnelRadius[100]).toBe(0)
  })

  it('reports a clear line of sight but a tight Fresnel zone for low antennas over flat ground', () => {
    const p = analyzePath(flat, 10, 2, radio)
    expect(p.losClear).toBe(true)
    expect(p.fresnelClearPct).toBeGreaterThan(5)
    expect(p.fresnelClearPct).toBeLessThan(40)
    expect(p.tightestIndex).toBeGreaterThan(20)
    expect(p.tightestIndex).toBeLessThan(80)
  })

  it('reports a fully clear Fresnel zone with tall masts', () => {
    const p = analyzePath(flat, 40, 40, radio)
    expect(p.fresnelClearPct).toBe(100)
    expect(p.losClear).toBe(true)
  })

  it('finds a ridge in the way, where it is, and how much it blocks', () => {
    const ridge = profile(10_000, 100, (t) => 300 + 120 * Math.exp(-(((t - 0.4) / 0.03) ** 2)))
    const p = analyzePath(ridge, 10, 2, radio)
    expect(p.losClear).toBe(false)
    expect(Math.abs(p.blockingIndex - 40)).toBeLessThanOrEqual(1)
    expect(p.clearance[p.blockingIndex]).toBeLessThan(-80)
    expect(p.fresnelClearPct).toBe(0)
  })

  it('has the path loss rise when a ridge blocks the path, and match a direct ITM call', () => {
    const ridge = profile(10_000, 100, (t) => 300 + 120 * Math.exp(-(((t - 0.4) / 0.03) ** 2)))
    const open = analyzePath(flat, 10, 2, radio)
    const blocked = analyzePath(ridge, 10, 2, radio)
    expect(blocked.pathLossDb).toBeGreaterThan(open.pathLossDb + 10)
    // (the model's mode is a distance regime, not a line-of-sight check: this short path is still inside the horizon)
    expect(blocked.mode).toBe(1)

    const pfl = new Float64Array(103)
    pfl[0] = 100
    pfl[1] = 100
    pfl.set(flat.elevation, 2)
    const direct = itmP2PTls({ hTx: 10, hRx: 2, climate: 5, n0: 301, fMhz: 915, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, time: 50, location: 50, situation: 50 }, pfl)
    expect(open.pathLossDb).toBeCloseTo(direct.lossDb, 9)
  })

  it('is NaN, not a number, when the model rejects an input', () => {
    const p = analyzePath(flat, 0.1, 2, radio) // antenna below the model's 0.5 m minimum
    expect(p.itmCode).toBeGreaterThanOrEqual(1000)
    expect(Number.isNaN(p.pathLossDb)).toBe(true)
    expect(p.effectiveEarthM).toBeCloseTo((4 / 3) * 6371008.8, 0)
  })
})

describe('budget and verdict', () => {
  const flat = profile(10_000, 100, () => 300)

  it('works out received power and margin per direction', () => {
    const p = analyzePath(flat, 40, 40, radio)
    const r = evaluateDirection(p, { label: 'A to B', budget, sensitivityDbm: -131.5 })
    expect(r.eirpDbm).toBeCloseTo(23.5, 9)
    expect(r.receivedDbm).toBeCloseTo(23.5 + 2 - p.pathLossDb, 6)
    expect(r.marginDb).toBeCloseTo(r.receivedDbm + 131.5, 9)
  })

  it('calls a strong, clear link good', () => {
    const p = analyzePath(flat, 40, 40, radio)
    const d = [evaluateDirection(p, { label: 'A to B', budget, sensitivityDbm: -131.5 })]
    const a = assess(p, d, null)
    expect(d[0].marginDb).toBeGreaterThan(GOOD_MARGIN_DB)
    expect(a.verdict).toBe('good')
    expect(a.headline).toBe('Link looks good')
    expect(a.reasons.some((r) => r.includes('Line of sight is clear'))).toBe(true)
  })

  it('calls a link with an obstructed Fresnel zone marginal, and says why', () => {
    const p = analyzePath(flat, 10, 2, radio)
    const a = assess(p, [evaluateDirection(p, { label: 'A to B', budget, sensitivityDbm: -131.5 })], null)
    expect(a.verdict).toBe('marginal')
    expect(a.headline).toContain('Fresnel zone obstructed')
    expect(a.reasons.join(' ')).toMatch(/Fresnel zone is \d+% clear/)
  })

  it('calls a link with too little signal poor, and a blocked but strong one marginal', () => {
    const p = analyzePath(flat, 10, 2, radio)
    const weak = assess(p, [evaluateDirection(p, { label: 'A to B', budget, sensitivityDbm: -60 })], null)
    expect(weak.verdict).toBe('poor')
    expect(weak.headline).toContain('below receiver sensitivity')
    const ridge = analyzePath(profile(10_000, 100, (t) => 300 + 120 * Math.exp(-(((t - 0.4) / 0.03) ** 2))), 10, 2, radio)
    const strongDir = { label: 'A to B', budget: { ...budget, txPowerDbm: 36 }, sensitivityDbm: -140 }
    const blocked = assess(ridge, [evaluateDirection(ridge, strongDir)], null)
    expect(evaluateDirection(ridge, strongDir).marginDb).toBeGreaterThan(0)
    expect(blocked.verdict).toBe('marginal')
    expect(blocked.headline).toContain('line of sight blocked')
    expect(blocked.reasons.join(' ')).toMatch(/blocked by \d+ m at \d+\.\d km/)
  })

  it('needs both directions to work, and names each', () => {
    const p = analyzePath(flat, 40, 40, radio)
    const good = evaluateDirection(p, { label: 'Hill to Barn', budget, sensitivityDbm: -131.5 })
    const bad = evaluateDirection(p, { label: 'Barn to Hill', budget: { ...budget, txPowerDbm: 0, txGainDbi: -8 }, sensitivityDbm: -60 })
    const a = assess(p, [good, bad], null)
    expect(a.verdict).toBe('poor')
    expect(a.reasons.some((r) => r.startsWith('Hill to Barn:'))).toBe(true)
    expect(a.reasons.some((r) => r.startsWith('Barn to Hill:'))).toBe(true)
  })

  it('rules out a link between different radio settings, however good the path', () => {
    const p = analyzePath(flat, 40, 40, radio)
    const a = assess(p, [evaluateDirection(p, { label: 'x', budget, sensitivityDbm: -131.5 })], 'SF11 / 250 kHz vs SF7 / 62.5 kHz')
    expect(a.verdict).toBe('poor')
    expect(a.reasons[0]).toContain('cannot hear each other')
  })

  it('says so when the model could not evaluate the path', () => {
    const p = analyzePath(flat, 0.1, 2, radio)
    const a = assess(p, [evaluateDirection(p, { label: 'x', budget, sensitivityDbm: -131.5 })], null)
    expect(a.verdict).toBe('poor')
    expect(a.headline).toBe('Link could not be evaluated')
  })

  it('turns model warning flags into sentences', () => {
    const short = analyzePath(profile(300, 6, () => 100), 10, 2, radio)
    const text = describeWarnings(short.warnings)
    expect(text.some((t) => /short path/.test(t))).toBe(true)
    expect(describeWarnings(0)).toEqual([])
  })
})

describe('terrain tiles for a link', () => {
  it('covers a path with a thin corridor, including both ends', () => {
    const b = { lat: 47, lng: 8.9 } // ~68 km east
    const z = 10
    const tiles = tilesAlongPath(A, b, z)
    const key = (lat: number, lng: number) => {
      const n = 2 ** z
      const x = Math.floor(((lng + 180) / 360) * n)
      const y = Math.floor((0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * n)
      return `${x}/${y}`
    }
    const set = new Set(tiles.map((t) => `${t.x}/${t.y}`))
    expect(set.has(key(A.lat, A.lng))).toBe(true)
    expect(set.has(key(b.lat, b.lng))).toBe(true)
    // a thin strip: a few tiles tall, never the whole bounding box
    const ys = new Set(tiles.map((t) => t.y))
    expect(ys.size).toBeLessThanOrEqual(3)
    expect(tiles.length).toBeLessThan(20)
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length)
  })

  it('wraps across the antimeridian', () => {
    const xs = new Set(tilesAlongPath({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }, 8).map((t) => t.x))
    expect(xs.has(255)).toBe(true)
    expect(xs.has(0)).toBe(true)
  })

  it('lowers the zoom to keep the tile count in check, and bounds a cache', () => {
    const far = { lat: 47, lng: 12 } // ~300 km
    const z = linkZoom(A, far, 30, 40, 13)
    expect(tilesAlongPath(A, far, z).length).toBeLessThanOrEqual(40)
    expect(linkZoom(A, { lat: 47, lng: 8.05 }, 30, 80, 12)).toBeGreaterThan(z)
    const c = new Map<string, number>([['a', 1], ['b', 2], ['c', 3]])
    trimCache(c, 2)
    expect([...c.keys()]).toEqual(['b', 'c'])
  })
})
