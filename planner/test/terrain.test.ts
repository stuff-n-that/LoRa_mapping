import { describe, expect, it } from 'vitest'
import { AzimuthalEquidistant, EARTH_RADIUS_M } from '../src/engine/geo'
import {
  buildDem,
  chooseZoom,
  decodeTerrarium,
  demAt,
  pixelSizeM,
  tilesCovering,
  tileUrl,
  TileElevation,
  TILE_SIZE,
} from '../src/engine/terrain'

function rgba(r: number, g: number, b: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) out.set([r, g, b, 255], i * 4)
  return out
}

describe('Terrarium decoding', () => {
  it('decodes metres from colours', () => {
    expect(decodeTerrarium(rgba(128, 0, 0))[0]).toBe(0)
    expect(decodeTerrarium(rgba(129, 0, 0))[0]).toBe(256)
    expect(decodeTerrarium(rgba(128, 100, 128))[0]).toBeCloseTo(100.5, 6)
    expect(decodeTerrarium(rgba(130, 17, 0))[0]).toBe(529)
  })
  it('clamps below-sea-level values to sea level', () => {
    expect(decodeTerrarium(rgba(127, 255, 0))[0]).toBe(0)
  })
  it('rejects a wrongly sized image', () => {
    expect(() => decodeTerrarium(new Uint8Array(10))).toThrow(RangeError)
  })
})

describe('tile maths', () => {
  it('builds tile URLs', () => {
    expect(tileUrl(10, 511, 340)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/511/340.png')
  })
  it('computes pixel size', () => {
    expect(pixelSizeM(0, 0)).toBeCloseTo((2 * Math.PI * EARTH_RADIUS_M) / 256, 6)
    expect(pixelSizeM(10, 60)).toBeCloseTo(pixelSizeM(10, 0) / 2, 3)
  })
  it('covers the circle and includes the centre tile', () => {
    const centre = { lat: 51.5, lng: -0.12 }
    const keys = tilesCovering(centre, 10_000, 10)
    const n = 2 ** 10
    const cx = Math.floor(((centre.lng + 180) / 360) * n)
    expect(keys.some((k) => k.x === cx)).toBe(true)
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect(keys.length).toBeLessThanOrEqual(9)
    expect(new Set(keys.map((k) => `${k.x}/${k.y}`)).size).toBe(keys.length)
  })
  it('wraps across the antimeridian', () => {
    const keys = tilesCovering({ lat: 0, lng: 179.99 }, 30_000, 9)
    const xs = new Set(keys.map((k) => k.x))
    expect(xs.has(2 ** 9 - 1)).toBe(true)
    expect(xs.has(0)).toBe(true)
  })
  it('limits the tile count by lowering the zoom', () => {
    const centre = { lat: 40, lng: -100 }
    const z = chooseZoom({ centre, radiusM: 50_000, targetCellM: 10, maxTiles: 36 })
    expect(tilesCovering(centre, 50_000, z).length).toBeLessThanOrEqual(36)
    const finer = chooseZoom({ centre, radiusM: 50_000, targetCellM: 10, maxTiles: 10_000 })
    expect(finer).toBeGreaterThan(z)
  })
})

/** Synthetic tiles whose elevation is a function of the global pixel position. */
function syntheticTiles(z: number, f: (ix: number, iy: number) => number, centreTiles: { x: number; y: number }[]) {
  const tiles = new Map<string, Float32Array>()
  for (const t of centreTiles) {
    const a = new Float32Array(TILE_SIZE * TILE_SIZE)
    for (let y = 0; y < TILE_SIZE; y++) for (let x = 0; x < TILE_SIZE; x++) a[y * TILE_SIZE + x] = f(t.x * TILE_SIZE + x, t.y * TILE_SIZE + y)
    tiles.set(`${t.x}/${t.y}`, a)
  }
  return new TileElevation(z, tiles)
}

describe('TileElevation', () => {
  it('interpolates smoothly across tile boundaries', () => {
    const z = 8
    const src = syntheticTiles(z, (ix) => ix * 2, [{ x: 100, y: 100 }, { x: 101, y: 100 }])
    // longitude of the centre of global pixel (101*256, 100.5*256)
    const n = 256 * 2 ** z
    const lngAt = (px: number) => ((px + 0.5) / n) * 360 - 180
    const latAt = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (py + 0.5)) / n))) * 180) / Math.PI
    const a = src.sample(latAt(100 * 256 + 50), lngAt(101 * 256 - 1))
    const b = src.sample(latAt(100 * 256 + 50), lngAt(101 * 256))
    expect(b - a).toBeCloseTo(2, 6)
    expect(src.sample(latAt(100 * 256 + 50), lngAt(101 * 256 - 1) + (lngAt(1) - lngAt(0)) / 2)).toBeCloseTo((a + b) / 2, 6)
  })
  it('reads missing tiles as sea level and counts them', () => {
    const src = new TileElevation(5, new Map())
    expect(src.sample(10, 10)).toBe(0)
    expect(src.missingLookups).toBeGreaterThan(0)
  })
})

describe('local elevation grid (DEM)', () => {
  it('reproduces a tilted plane in the right directions', () => {
    const z = 10
    const origin = { lat: 47, lng: 8 }
    // elevation rises with x (eastwards) and falls with y (southwards on screen = northwards uphill)
    const n = 256 * 2 ** z
    const ox = ((origin.lng + 180) / 360) * n
    const oy = (0.5 - Math.log(Math.tan(Math.PI / 4 + (origin.lat * Math.PI) / 360)) / (2 * Math.PI)) * n
    const tx = Math.floor(ox / 256)
    const ty = Math.floor(oy / 256)
    const tiles: { x: number; y: number }[] = []
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) tiles.push({ x: tx + dx, y: ty + dy })
    // pixel (ix, iy) is centred half a pixel in
    const src = syntheticTiles(z, (ix, iy) => 500 + (ix + 0.5 - ox) * 0.5 - (iy + 0.5 - oy) * 0.25, tiles)
    const dem = buildDem(src, origin, 5000, 90)
    const px = pixelSizeM(z, origin.lat)
    expect(demAt(dem, 0, 0)).toBeCloseTo(500, 1)
    // 1 km east = 1000/px pixels
    expect(demAt(dem, 1000, 0)).toBeCloseTo(500 + (1000 / px) * 0.5, 0)
    // 1 km north = 1000/px pixels fewer rows (y grows southwards)
    expect(demAt(dem, 0, 1000)).toBeCloseTo(500 + (1000 / px) * 0.25, 0)
    // out-of-range lookups clamp instead of reading garbage
    expect(Number.isFinite(demAt(dem, 1e6, -1e6))).toBe(true)
  })

  it('centres the transmitter on the middle cell', () => {
    const src = syntheticTiles(8, () => 123, [])
    const dem = buildDem(src, { lat: 10, lng: 10 }, 1000, 100)
    expect(dem.size % 2).toBe(1)
    expect(dem.centre).toBe((dem.size - 1) / 2)
    const proj = new AzimuthalEquidistant({ lat: 10, lng: 10 })
    expect(proj).toBeDefined()
  })
})
