// Both MeshCore and Meshtastic's APIs return full node history, not just
// nodes currently on the mesh — real data pulled 2026-09-22 came back as
// 63,658 MeshCore + 17,973 Meshtastic nodes, the overwhelming majority of
// which are surely long-dead. Rendering (or even just downloading and
// JSON-parsing) that many nodes hangs the page, especially on mobile.
// Filtering to recent activity is both a performance fix and a more useful
// "live" map — a node not heard from in a week isn't meaningfully live.
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function isRecentlyActive(lastSeen, windowMs = ACTIVE_WINDOW_MS) {
  if (!lastSeen) return false
  const seenAt = new Date(lastSeen).getTime()
  if (Number.isNaN(seenAt)) return false
  return Date.now() - seenAt <= windowMs
}
