import { describe, expect, it } from 'vitest'
import {
  AzimuthalEquidistant,
  bearingDeg,
  haversineM,
  lngLatToMercator,
  mercatorToLngLat,
  type LatLng,
} from '../src/engine/geo'

const origins: LatLng[] = [
  { lat: 0.5, lng: 10 },
  { lat: 51.5, lng: -0.12 },
  { lat: -33.9, lng: 151.2 },
  { lat: 64.1, lng: -21.9 },
  { lat: 35, lng: 179.95 }, // next to the antimeridian
]

describe('azimuthal-equidistant projection', () => {
  it('round-trips and preserves distance from the origin', () => {
    for (const o of origins) {
      const proj = new AzimuthalEquidistant(o)
      for (const [x, y] of [[0, 0], [1000, 0], [0, -2500], [-12000, 8000], [45000, 30000], [-60000, -50000]]) {
        const ll = { lat: 0, lng: 0 }
        proj.inverse(x, y, ll)
        const back = { x: 0, y: 0 }
        proj.forward(ll.lat, ll.lng, back)
        expect(back.x).toBeCloseTo(x, 3)
        expect(back.y).toBeCloseTo(y, 3)
        // distance from the origin is the great-circle distance
        expect(haversineM(o, ll)).toBeCloseTo(Math.hypot(x, y), 2)
      }
    }
  })

  it('points the right way: east is +x, north is +y, and bearings agree', () => {
    const o = origins[1]
    const proj = new AzimuthalEquidistant(o)
    const p = { x: 0, y: 0 }
    proj.forward(o.lat, o.lng + 0.1, p)
    expect(p.x).toBeGreaterThan(0)
    expect(Math.abs(p.y)).toBeLessThan(0.002 * p.x) // great circles bend poleward, only slightly
    proj.forward(o.lat + 0.1, o.lng, p)
    expect(p.y).toBeGreaterThan(0)
    expect(p.x).toBeCloseTo(0, 6)

    const target = { lat: o.lat + 0.2, lng: o.lng - 0.3 }
    proj.forward(target.lat, target.lng, p)
    const bearingFromXY = ((Math.atan2(p.x, p.y) * 180) / Math.PI + 360) % 360
    expect(bearingFromXY).toBeCloseTo(bearingDeg(o, target), 6)
  })
})

describe('web mercator', () => {
  it('round-trips', () => {
    for (const o of origins) {
      const m = lngLatToMercator(o.lng, o.lat)
      const back = mercatorToLngLat(m.u, m.v)
      expect(back.lat).toBeCloseTo(o.lat, 9)
      expect(back.lng).toBeCloseTo(o.lng, 9)
    }
  })

  it('puts the equator/prime meridian at the centre of the world', () => {
    const m = lngLatToMercator(0, 0)
    expect(m.u).toBeCloseTo(0.5, 12)
    expect(m.v).toBeCloseTo(0.5, 12)
  })
})
