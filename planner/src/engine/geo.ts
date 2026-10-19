// Spherical-earth geometry helpers.
//
// Coverage is computed in an azimuthal-equidistant projection centred on the
// transmitter: every great circle through the centre is a straight line there
// and distances from the centre are exact, so a terrain profile for any
// receiver is just a straight line through a local elevation grid.

export const EARTH_RADIUS_M = 6371008.8
export const DEG = Math.PI / 180

export interface LatLng {
  lat: number
  lng: number
}

/** Normalised Web Mercator (0..1 across the world, v increasing southward), as MapLibre uses. */
export function lngLatToMercator(lng: number, lat: number): { u: number; v: number } {
  const u = (lng + 180) / 360
  const v = 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / (2 * Math.PI)
  return { u, v }
}

export function mercatorToLngLat(u: number, v: number): LatLng {
  const lng = u * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI
  return { lat, lng }
}

/** Ground metres spanned by one unit of normalised Mercator u at a latitude. */
export function metersPerMercatorUnit(lat: number): number {
  return 2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * DEG)
}

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG
  const dLng = (b.lng - a.lng) * DEG
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const p1 = a.lat * DEG
  const p2 = b.lat * DEG
  const dl = (b.lng - a.lng) * DEG
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360
}

/** Azimuthal-equidistant projection about an origin; x is east, y is north, in metres. */
export class AzimuthalEquidistant {
  private readonly lat0: number
  private readonly lng0: number
  private readonly sinLat0: number
  private readonly cosLat0: number

  constructor(origin: LatLng) {
    this.lat0 = origin.lat * DEG
    this.lng0 = origin.lng * DEG
    this.sinLat0 = Math.sin(this.lat0)
    this.cosLat0 = Math.cos(this.lat0)
  }

  forward(lat: number, lng: number, out: { x: number; y: number }): void {
    const phi = lat * DEG
    const dl = lng * DEG - this.lng0
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const sinDl = Math.sin(dl)
    const cosDl = Math.cos(dl)

    // central angle via haversine (stable for small distances)
    const hav = Math.sin((phi - this.lat0) / 2) ** 2 + this.cosLat0 * cosPhi * Math.sin(dl / 2) ** 2
    const c = 2 * Math.asin(Math.min(1, Math.sqrt(hav)))
    if (c < 1e-12) {
      out.x = 0
      out.y = 0
      return
    }
    const k = (EARTH_RADIUS_M * c) / Math.sin(c)
    out.x = k * cosPhi * sinDl
    out.y = k * (this.cosLat0 * sinPhi - this.sinLat0 * cosPhi * cosDl)
  }

  inverse(x: number, y: number, out: LatLng): void {
    const rho = Math.hypot(x, y)
    if (rho < 1e-9) {
      out.lat = this.lat0 / DEG
      out.lng = this.lng0 / DEG
      return
    }
    const c = rho / EARTH_RADIUS_M
    const sinC = Math.sin(c)
    const cosC = Math.cos(c)
    const lat = Math.asin(cosC * this.sinLat0 + (y * sinC * this.cosLat0) / rho)
    const lng = this.lng0 + Math.atan2(x * sinC, rho * this.cosLat0 * cosC - y * this.sinLat0 * sinC)
    out.lat = lat / DEG
    out.lng = (((lng / DEG + 540) % 360) - 180)
  }
}
