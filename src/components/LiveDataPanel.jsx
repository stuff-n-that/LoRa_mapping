import { formatAgo } from '../utils/format'
import CollapsibleSection from './CollapsibleSection'

function statusText(live) {
  if (live.status === 'loading' && !live.updatedAt) return 'loading…'
  if (live.status === 'error') return `error: ${live.error}`
  if (live.status === 'ready') return `${live.nodes.length} nodes · updated ${formatAgo(live.updatedAt)}`
  return 'off'
}

function LiveSourceRow({ label, enabled, onToggle, live }) {
  return (
    <div className="live-row">
      <label className="live-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      <span className={`live-status live-status-${live.status}`}>{statusText(live)}</span>
      {enabled && (
        <button className="btn-secondary live-refresh" onClick={live.refresh} title="Refresh now">
          ↻
        </button>
      )}
    </div>
  )
}

export default function LiveDataPanel({ meshcoreLive, meshtasticLive, meshcoreOn, meshtasticOn, onToggleMeshcore, onToggleMeshtastic }) {
  const onCount = [meshcoreOn, meshtasticOn].filter(Boolean).length
  const summary = onCount > 0 ? `${onCount} on` : 'off'

  return (
    <CollapsibleSection title="Live data" summary={summary} className="live-panel">
      <LiveSourceRow label="MeshCore" enabled={meshcoreOn} onToggle={onToggleMeshcore} live={meshcoreLive} />
      <LiveSourceRow label="Meshtastic" enabled={meshtasticOn} onToggle={onToggleMeshtastic} live={meshtasticLive} />
      <p className="live-panel-note">
        Best-effort feeds from public community maps, refreshed every 5 min. May be unavailable if the source is down or blocks
        cross-site requests.
      </p>
    </CollapsibleSection>
  )
}
