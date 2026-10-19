// Terrain: AWS Terrain Tiles ("Terrarium" PNGs) -> a local elevation grid.
//
// Tiles are public, free and allow cross-origin reads, so everything runs in
// the browser. Elevation is encoded in the PNG colours:
//   metres = (R * 256 + G + B / 256) - 32768
// Source data (SRTM, EU-DEM, GMTED, ETOPO1 and others) is listed in the
// attribution returned by TERRAIN_ATTRIBUTION.

import { AzimuthalEquidistant, DEG, EARTH_RADIUS_M, type LatLng } from './geo'

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

export const TERRAIN_ATTRIBUTION = 'Terrain: AWS Terrain Tiles (SRTM, EU-DEM, GMTED2010, 3DEP, ETOPO1)'

export const TILE_SIZE = 256

export function tileUrl(z: number, x: number, y: number, template = TERRARIUM_URL): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** Decode a Terrarium RGBA image into metres. Negative values (sea bed, trenches) are clamped to 0. */
export function decodeTerrarium(rgba: ArrayLike<number>): Float32Array {
  const n = TILE_SIZE * TILE_SIZE
  if (rgba.length < n * 4) throw new RangeError('terrain tile has the wrong size')
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const m = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768
    out[i] = m > 0 ? m : 0
  }
  return out
}

/** Ground size of one tile pixel at a latitude, metres. */
export function pixelSizeM(zoom: number, latDeg: number): number {
  return (2 * Math.PI * EARTH_RADIUS_M * Math.cos(latDeg * DEG)) / (TILE_SIZE * 2 ** zoom)
}

export interface TileKey {
  x: number
  y: number
}

/** Tiles needed to cover a circle of `radiusM` around a point at zoom `z`, with a small margin. */
export function tilesCovering(centre: LatLng, radiusM: number, z: number): TileKey[] {
  const n = 2 ** z
  const dLat = (radiusM / EARTH_RADIUS_M) / DEG
  const dLng = dLat / Math.max(0.05, Math.cos(centre.lat * DEG))
  const margin = 0.02 // degrees-ish safety margin for bilinear edges
  const latMax = Math.min(85.0511, centre.lat + dLat * (1 + margin))
  const latMin = Math.max(-85.0511, centre.lat - dLat * (1 + margin))

  const tx = (lng: number) => ((lng + 180) / 360) * n
  const ty = (lat: number) => (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / (2 * Math.PI)) * n

  const x0 = Math.floor(tx(centre.lng - dLng * (1 + margin)))
  const x1 = Math.floor(tx(centre.lng + dLng * (1 + margin)))
  const y0 = Math.max(0, Math.floor(ty(latMax)))
  const y1 = Math.min(n - 1, Math.floor(ty(latMin)))

  const out: TileKey[] = []
  const seen = new Set<string>()
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wx = ((x % n) + n) % n // wrap across the antimeridian
      const key = `${wx}/${y}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ x: wx, y })
      }
    }
  }
  return out
}

/**
 * The tiles a path from `a` to `b` passes through at zoom `z`, plus the neighbours a bilinear lookup
 * near a tile edge can touch. Far fewer than the whole bounding box for a long, thin path.
 */
export function tilesAlongPath(a: LatLng, b: LatLng, z: number): TileKey[] {
  const n = 2 ** z
  const world = TILE_SIZE * n
  const proj = new AzimuthalEquidistant(a)
  const end = { x: 0, y: 0 }
  proj.forward(b.lat, b.lng, end)
  const d = Math.hypot(end.x, end.y)
  const widest = Math.max(Math.abs(a.lat), Math.abs(b.lat))
  const tileGroundM = (2 * Math.PI * EARTH_RADIUS_M * Math.cos(widest * DEG)) / n
  const steps = Math.max(1, Math.ceil(d / (tileGroundM / 2)))
  const seen = new Set<string>()
  const out: TileKey[] = []
  const ll = { lat: 0, lng: 0 }
  for (let k = 0; k <= steps; k++) {
    proj.inverse((end.x * k) / steps, (end.y * k) / steps, ll)
    const px = ((ll.lng + 180) / 360) * world
    const py = (0.5 - Math.log(Math.tan(Math.PI / 4 + (ll.lat * DEG) / 2)) / (2 * Math.PI)) * world
    for (const dx of [-2, 0, 2]) {
      for (const dy of [-2, 0, 2]) {
        const tx = (((Math.floor((px + dx) / TILE_SIZE) % n) + n) % n)
        const ty = Math.min(n - 1, Math.max(0, Math.floor((py + dy) / TILE_SIZE)))
        const key = `${tx}/${ty}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ x: tx, y: ty })
        }
      }
    }
  }
  return out
}

/** The finest zoom (up to `maxZoom`) at which the corridor of a path needs no more than `maxTiles` tiles. */
export function linkZoom(a: LatLng, b: LatLng, targetCellM: number, maxTiles = 80, maxZoom = 12): number {
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
  const wanted = Math.round(Math.log2((2 * Math.PI * EARTH_RADIUS_M * Math.cos(mid.lat * DEG)) / (TILE_SIZE * targetCellM)))
  let z = Math.max(5, Math.min(maxZoom, wanted))
  while (z > 5 && tilesAlongPath(a, b, z).length > maxTiles) z--
  return z
}

/** Drop the oldest entries so a long-lived tile cache stays bounded. */
export function trimCache<V>(cache: Map<string, V>, max: number): void {
  while (cache.size > max) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * Pick a tile zoom whose pixels are about `targetCellM` wide, but not so deep that
 * the number of tiles to download passes `maxTiles`.
 */
export function chooseZoom(opts: { centre: LatLng; radiusM: number; targetCellM: number; maxTiles?: number; maxZoom?: number }): number {
  const { centre, radiusM, targetCellM, maxTiles = 64, maxZoom = 13 } = opts
  const wanted = Math.round(Math.log2((2 * Math.PI * EARTH_RADIUS_M * Math.cos(centre.lat * DEG)) / (TILE_SIZE * targetCellM)))
  let z = Math.max(5, Math.min(maxZoom, wanted))
  while (z > 5 && tilesCovering(centre, radiusM, z).length > maxTiles) z--
  return z
}

/** Bilinear elevation lookup over a set of decoded tiles at one zoom level. Missing tiles read as sea level. */
export class TileElevation {
  readonly zoom: number
  private readonly tiles: Map<string, Float32Array>
  private readonly size: number
  missingLookups = 0

  constructor(zoom: number, tiles: Map<string, Float32Array>) {
    this.zoom = zoom
    this.tiles = tiles
    this.size = TILE_SIZE * 2 ** zoom
  }

  private pixel(ix: number, iy: number): number {
    const n = this.size
    const x = ((ix % n) + n) % n
    const y = iy < 0 ? 0 : iy >= n ? n - 1 : iy
    const tile = this.tiles.get(`${x >> 8}/${y >> 8}`)
    if (!tile) {
      this.missingLookups++
      return 0
    }
    return tile[((y & 255) << 8) | (x & 255)]
  }

  sample(lat: number, lng: number): number {
    const n = this.size
    const fx = ((lng + 180) / 360) * n - 0.5
    const fy = (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / (2 * Math.PI)) * n - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const a = this.pixel(x0, y0)
    const b = this.pixel(x0 + 1, y0)
    const c = this.pixel(x0, y0 + 1)
    const d = this.pixel(x0 + 1, y0 + 1)
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
  }
}

/** A square elevation grid in the local azimuthal-equidistant frame around the transmitter. */
export interface Dem {
  data: Float32Array
  /** Cells per side (odd, so the transmitter sits on the centre cell). */
  size: number
  cellM: number
  /** Centre cell index (size - 1) / 2. */
  centre: number
}

export function buildDem(source: TileElevation, origin: LatLng, radiusM: number, cellM: number): Dem {
  const half = Math.ceil(radiusM / cellM) + 2
  const size = 2 * half + 1
  const data = new Float32Array(size * size)
  const proj = new AzimuthalEquidistant(origin)
  const ll: LatLng = { lat: 0, lng: 0 }
  for (let j = 0; j < size; j++) {
    const y = (j - half) * cellM
    for (let i = 0; i < size; i++) {
      proj.inverse((i - half) * cellM, y, ll)
      data[j * size + i] = source.sample(ll.lat, ll.lng)
    }
  }
  return { data, size, cellM, centre: half }
}

/** Bilinear elevation at local metres (x east, y north) from the DEM centre. */
export function demAt(dem: Dem, x: number, y: number): number {
  const max = dem.size - 1
  let fi = x / dem.cellM + dem.centre
  let fj = y / dem.cellM + dem.centre
  if (fi < 0) fi = 0
  else if (fi > max) fi = max
  if (fj < 0) fj = 0
  else if (fj > max) fj = max
  let i0 = Math.floor(fi)
  let j0 = Math.floor(fj)
  if (i0 >= max) i0 = max - 1
  if (j0 >= max) j0 = max - 1
  const tx = fi - i0
  const ty = fj - j0
  const k = j0 * dem.size + i0
  const d = dem.data
  return d[k] * (1 - tx) * (1 - ty) + d[k + 1] * tx * (1 - ty) + d[k + dem.size] * (1 - tx) * ty + d[k + dem.size + 1] * tx * ty
}

// ---- Network ------------------------------------------------------------------

export interface FetchTilesOptions {
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  concurrency?: number
  urlTemplate?: string
  retries?: number
  /**
   * Decoded tiles already fetched, keyed "z/x/y" (null = the server has no such tile). Pass the same
   * map for several calls (the nodes of one plan) so overlapping areas are downloaded once.
   */
  cache?: Map<string, Float32Array | null>
}

async function decodeBlob(blob: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TILE_SIZE, TILE_SIZE) : Object.assign(document.createElement('canvas'), { width: TILE_SIZE, height: TILE_SIZE })
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!ctx) throw new Error('canvas 2D is not available')
    ctx.drawImage(bitmap, 0, 0)
    return decodeTerrarium(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data)
  } finally {
    bitmap.close()
  }
}

/**
 * Download and decode tiles. A 404 means no tile (treated as sea level); any other
 * failure is retried and then thrown, so a broken download never silently becomes flat ground.
 */
export async function fetchTiles(z: number, keys: TileKey[], opts: FetchTilesOptions = {}): Promise<Map<string, Float32Array>> {
  const { signal, onProgress, concurrency = 8, urlTemplate = TERRARIUM_URL, retries = 2, cache } = opts
  const out = new Map<string, Float32Array>()
  let next = 0
  let done = 0

  async function one(k: TileKey): Promise<void> {
    const cacheKey = `${z}/${k.x}/${k.y}`
    if (cache?.has(cacheKey)) {
      const hit = cache.get(cacheKey)
      if (hit) out.set(`${k.x}/${k.y}`, hit)
      return
    }
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal?.throwIfAborted()
      try {
        const res = await fetch(tileUrl(z, k.x, k.y, urlTemplate), { signal })
        if (res.status === 404) {
          cache?.set(cacheKey, null)
          return
        }
        if (!res.ok) throw new Error(`terrain tile ${z}/${k.x}/${k.y} responded ${res.status}`)
        const tile = await decodeBlob(await res.blob())
        cache?.set(cacheKey, tile)
        out.set(`${k.x}/${k.y}`, tile)
        return
      } catch (err) {
        if (signal?.aborted) throw err
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('terrain download failed')
  }

  async function worker(): Promise<void> {
    while (next < keys.length) {
      const k = keys[next++]
      await one(k)
      onProgress?.(++done, keys.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker))
  return out
}
