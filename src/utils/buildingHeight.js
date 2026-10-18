// Real coverage, measured against a full Luxembourg pull: only ~10% of
// buildings carry a height or floor-count at all, country-wide. So "no
// data" is the normal case, not an edge case — it must never be drawn as
// if it meant "flat" or "no obstruction". Buildings with no height are a
// distinct neutral style here, not bucketed into the color scale at all.

// OSM wiki's documented "usual" per-floor height, used only when a
// building has a floor count but no reported height — this produces an
// ESTIMATE, rendered visibly differently (dashed, lower opacity) from a
// reported height in buildingStyle() below.
const ESTIMATE_FLOOR_HEIGHT_M = 3

// Low-rise to high-rise, yellow through red — deliberately avoids blue/green
// (already used for MeshCore/Meshtastic node markers) and amber (the
// measure tool), so a buildings layer never reads as a third node network.
const HEIGHT_BUCKETS = [
  { max: 10, color: '#ffe08a' },
  { max: 20, color: '#ffb74d' },
  { max: 40, color: '#ff8a3d' },
  { max: 80, color: '#ff5a36' },
  { max: Infinity, color: '#d32f2f' },
]

const UNKNOWN_COLOR = '#55555f'

export function colorForHeight(meters) {
  return (HEIGHT_BUCKETS.find((b) => meters < b.max) || HEIGHT_BUCKETS[HEIGHT_BUCKETS.length - 1]).color
}

// Returns { meters, isEstimate } from a tile feature's properties, or null
// when there's genuinely nothing to go on — never a silent default.
export function resolveHeight(properties) {
  if (typeof properties?.h === 'number') return { meters: properties.h, isEstimate: false }
  if (typeof properties?.lvl === 'number') return { meters: properties.lvl * ESTIMATE_FLOOR_HEIGHT_M, isEstimate: true }
  return null
}

export function buildingStyle(properties) {
  const resolved = resolveHeight(properties)
  if (!resolved) {
    return { color: '#2a2a30', weight: 1, fillColor: UNKNOWN_COLOR, fillOpacity: 0.25 }
  }
  const color = colorForHeight(resolved.meters)
  return resolved.isEstimate
    ? { color, weight: 1, dashArray: '3 3', fillColor: color, fillOpacity: 0.35 }
    : { color, weight: 1, fillColor: color, fillOpacity: 0.55 }
}
