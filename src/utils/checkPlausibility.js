// Flags nodes whose claimed public-map position looks implausible given
// what your own hardware can actually hear over RF. This is plain distance
// math, not "AI verification" — an LLM doesn't help here, a haversine check
// against a sane single-hop range does.
//
// A single LoRa hop can realistically span anywhere from a few hundred
// metres (urban, low antenna) to 100km+ (line-of-sight, mountaintop-to-
// mountaintop). There's no one correct cutoff — MAX_PLAUSIBLE_HOP_KM is
// deliberately generous so this only flags genuinely implausible cases
// (e.g. a "direct neighbour" whose public position is another country
// away), not just unusually long but real links. Tune it for your terrain.
const EARTH_RADIUS_KM = 6371
const MAX_PLAUSIBLE_HOP_KM = 300

function toRadians(deg) {
  return (deg * Math.PI) / 180
}

// Great-circle distance between two lat/lng points, in kilometres.
export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

// localNodes: nodes read directly off your hardware (source: 'local'),
// including the ones you've heard directly (hopsAway === 0).
// publicNodesById: Map (or plain object) of the same node's id -> the
// community-map node for it, e.g. built from the live/region-snapshot data
// already loaded in the app.
//
// Returns one report entry per locally-heard node, categorized so a
// missing/unmatched public entry is never conflated with a wrong one:
//   - 'not-on-public-map': you hear them directly, but they don't appear in
//     the community data at all — not necessarily wrong, they may simply
//     not have opted into public reporting.
//   - 'implausible-distance': they ARE on the public map, but its position
//     for them is farther from you than a single hop should plausibly be.
//   - 'ok': on the public map, at a plausible distance.
export function checkLocalNeighbourPlausibility(localNodes, publicNodesById, { myLat, myLng, maxHopKm = MAX_PLAUSIBLE_HOP_KM } = {}) {
  const lookup = publicNodesById instanceof Map ? publicNodesById : new Map(Object.entries(publicNodesById || {}))

  return localNodes
    .filter((n) => n.heardDirectly)
    .map((local) => {
      const publicNode = lookup.get(local.id)
      if (!publicNode) {
        return { id: local.id, name: local.name, status: 'not-on-public-map' }
      }
      const distanceKm = haversineDistanceKm(myLat, myLng, publicNode.lat, publicNode.lng)
      return {
        id: local.id,
        name: local.name,
        status: distanceKm > maxHopKm ? 'implausible-distance' : 'ok',
        distanceKm: Math.round(distanceKm * 10) / 10,
        publicLat: publicNode.lat,
        publicLng: publicNode.lng,
      }
    })
}
