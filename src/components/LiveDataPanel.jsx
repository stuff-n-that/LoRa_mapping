function statusText(live) {
  if (live.status === 'loading' && !live.updatedAt) return 'loading…'
  if (live.status === 'error') return `error: ${live.error}`
  if (live.status === 'ready') return `${live.nodes.length} nodes · updated ${formatAgo(live.updatedAt)}`
  return 'off'
}

function formatAgo(date) {
  if (!date) return ''
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes}m ago`
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
  return (
    <div className="live-panel">
      <div className="live-panel-title">Live data</div>
      <LiveSourceRow label="MeshCore" enabled={meshcoreOn} onToggle={onToggleMeshcore} live={meshcoreLive} />
      <LiveSourceRow label="Meshtastic" enabled={meshtasticOn} onToggle={onToggleMeshtastic} live={meshtasticLive} />
      <p className="live-panel-note">
        Best-effort feeds from public community maps, refreshed every 5 min. May be unavailable if the source is down or blocks
        cross-site requests.
      </p>
    </div>
  )
}
