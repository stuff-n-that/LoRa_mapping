// Used only by the browser bundle when built with VITE_LIVE_PROXY=true (see
// server/index.js and the "Toward a real local/server deployment" section of
// the README). Fetches already-normalized node data from this app's own
// backend instead of the upstream APIs directly, sidestepping CORS entirely
// since the request stays same-origin.
export async function fetchFromLiveProxy(source, signal) {
  const res = await fetch(`/api/live-nodes/${source}`, { signal })
  if (!res.ok) throw new Error(`Local live-data proxy responded ${res.status}`)
  const data = await res.json()
  if (data.nodes.length === 0 && data.error) throw new Error(data.error)
  return data.nodes
}
