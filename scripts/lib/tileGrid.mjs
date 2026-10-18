// Standard Web Mercator slippy-map tile grid (the same scheme every XYZ tile
// layer uses, including the base layers this app already renders with
// Leaflet). Used to chunk building footprints into small per-tile files the
// frontend can fetch by viewport instead of one giant per-country file —
// buildings are far denser than node points, so the per-country sharding
// that works for nodes doesn't scale the same way here.
//
// BUILDING_TILE_ZOOM=14 was picked from real measurements: a z14 tile runs
// roughly 1-2km across and, after simplification, costs ~1MB even over a
// dense city core (SF/Nairobi test data) down to ~10KB over rural land —
// z12/z13 ran 3-16MB per tile in the same test, too big for one fetch.
export const BUILDING_TILE_ZOOM = 14

export function lonToTileX(lon, zoom = BUILDING_TILE_ZOOM) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}

export function latToTileY(lat, zoom = BUILDING_TILE_ZOOM) {
  const latRad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom,
  )
}

export function tileKey(x, y) {
  return `${x}_${y}`
}
