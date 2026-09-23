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

function geometryToPolygons(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

// A handful of countries (Russia, Fiji here) have a polygon piece that
// crosses the antimeridian (±180°) as a single ring, e.g. Russia's mainland
// runs ...178, 179, -179, -178... in raw coordinates. A plain ray-cast
// treats the "jump" from +179 to -179 as one edge spanning the *entire*
// longitude range, which creates a false-positive match band at that
// piece's latitude range across nearly every longitude on Earth — this
// was reported as real Finland/Norway/UK/Germany/Romania nodes all coming
// back tagged as Russia. Detected by having points on both sides of ±90°,
// fixed by unwrapping longitudes < 0 onto a continuous 0–360 range (and
// unwrapping the query point the same way before testing against it).
function crossesAntimeridian(ring) {
  let hasEast = false
  let hasWest = false
  for (const [x] of ring) {
    if (x > 90) hasEast = true
    if (x < -90) hasWest = true
  }
  return hasEast && hasWest
}

function unwrapLng(lng) {
  return lng < 0 ? lng + 360 : lng
}

function ringBBox(ring, bbox) {
  for (const [x, y] of ring) {
    if (x < bbox[0]) bbox[0] = x
    if (y < bbox[1]) bbox[1] = y
    if (x > bbox[2]) bbox[2] = x
    if (y > bbox[3]) bbox[3] = y
  }
}

// Each polygon piece gets its own bbox and wrap state (rather than one
// bbox for the whole, possibly-multi-piece, country) so a piece that
// crosses the antimeridian doesn't blow out the bounding box — and
// therefore the false-positive area — for the country's other pieces too.
function preparePolygonPieces(geometry) {
  return geometryToPolygons(geometry).map((rings) => {
    const wraps = rings.some(crossesAntimeridian)
    const preparedRings = wraps ? rings.map((ring) => ring.map(([x, y]) => [unwrapLng(x), y])) : rings
    const bbox = [Infinity, Infinity, -Infinity, -Infinity]
    for (const ring of preparedRings) ringBBox(ring, bbox)
    return { rings: preparedRings, bbox, wraps }
  })
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
  pieces: preparePolygonPieces(f.geometry),
}))

export function getCountryForPoint(lat, lng) {
  for (const country of countryFeatures) {
    for (const piece of country.pieces) {
      const testLng = piece.wraps ? unwrapLng(lng) : lng
      const [minX, minY, maxX, maxY] = piece.bbox
      if (testLng < minX || testLng > maxX || lat < minY || lat > maxY) continue
      if (pointInPolygon(testLng, lat, piece.rings)) {
        return { code: country.code, name: country.name }
      }
    }
  }
  return null
}

export function listCountries() {
  return countryFeatures.map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
}
