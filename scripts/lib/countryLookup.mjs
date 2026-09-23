// Assigns a lat/lng to a country using real boundary polygons (Natural
// Earth 1:110m resolution via world-atlas — coarse but genuine country
// shapes, not bounding boxes). Used to shard the live-node snapshot by
// country so each region's file stays small without needing to filter out
// nodes by activity/age.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { feature } from 'topojson-client'
import countries from 'i18n-iso-countries'

const topoPath = fileURLToPath(new URL('../../node_modules/world-atlas/countries-110m.json', import.meta.url))
const topology = JSON.parse(readFileSync(topoPath, 'utf8'))
const geojson = feature(topology, topology.objects.countries)

function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// XOR across every ring (outer + holes) is the standard correct way to
// test point-in-polygon-with-holes via ray casting, regardless of winding order.
function pointInPolygon(lng, lat, rings) {
  let inside = false
  for (const ring of rings) {
    if (pointInRing(lng, lat, ring)) inside = !inside
  }
  return inside
}

function pointInMultiPolygon(lng, lat, polygons) {
  return polygons.some((polygon) => pointInPolygon(lng, lat, polygon))
}

function geometryToPolygons(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

function geometryBBox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < bbox[0]) bbox[0] = x
        if (y < bbox[1]) bbox[1] = y
        if (x > bbox[2]) bbox[2] = x
        if (y > bbox[3]) bbox[3] = y
      }
    }
  }
  return bbox
}

// A few disputed territories (Kosovo, Somaliland, N. Cyprus in this
// dataset) have no numeric ISO id at all — not even Natural Earth's usual
// -99 placeholder — so f.id is JS `undefined` for them. Falling back to
// f.id directly (rather than deriving a code from the name) previously
// produced a literal "undefined.json" file, silently merging all such
// territories' nodes together. A slugified name is stable and unique.
function fallbackCode(name) {
  return name.toUpperCase().replace(/[^A-Z]+/g, '-')
}

const countryFeatures = geojson.features.map((f) => ({
  code: countries.numericToAlpha2(f.id) || fallbackCode(f.properties.name),
  name: f.properties.name,
  bbox: geometryBBox(f.geometry),
  polygons: geometryToPolygons(f.geometry),
}))

export function getCountryForPoint(lat, lng) {
  for (const country of countryFeatures) {
    const [minX, minY, maxX, maxY] = country.bbox
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue
    if (pointInMultiPolygon(lng, lat, country.polygons)) {
      return { code: country.code, name: country.name }
    }
  }
  return null
}

export function listCountries() {
  return countryFeatures.map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
}
