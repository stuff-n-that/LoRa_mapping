// Links from the map into the coverage planner (see planner/).
//
// The planner is a separate app published next to the map: /map/ -> /plan/.
// In dev the two run on different servers, so VITE_PLANNER_URL can point
// at the planner's dev server (e.g. http://localhost:5173/).
const PLANNER_BASE = import.meta.env.VITE_PLANNER_URL || '../plan/'

/**
 * URL of the planner, optionally opened at a location and with the same
 * countries' node data selected. The planner reads these from its URL hash.
 */
export function plannerUrl({ lat, lng, regions } = {}) {
  const q = new URLSearchParams()
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    q.set('lat', lat.toFixed(6))
    q.set('lng', lng.toFixed(6))
  }
  if (regions && regions.length > 0) q.set('r', regions.join(','))
  const hash = q.toString()
  return hash ? `${PLANNER_BASE}#${hash}` : PLANNER_BASE
}
