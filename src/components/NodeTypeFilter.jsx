import CollapsibleSection from './CollapsibleSection'
import { ROLE_CATEGORIES } from '../utils/nodeRoles'

export default function NodeTypeFilter({ enabledCategories, onChange }) {
  function toggle(key) {
    const next = new Set(enabledCategories)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  const summary =
    enabledCategories.size === ROLE_CATEGORIES.length ? 'all shown' : `${enabledCategories.size}/${ROLE_CATEGORIES.length} shown`

  return (
    <CollapsibleSection title="Node type" summary={summary} className="node-type-panel">
      <div className="node-type-list">
        {ROLE_CATEGORIES.map(({ key, label }) => (
          <label key={key} className="node-type-item">
            <input type="checkbox" checked={enabledCategories.has(key)} onChange={() => toggle(key)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="node-type-note">
        Applies to MeshCore and Meshtastic data (live or region snapshots) — normalizes each network's own node types into
        one shared set. Manually added nodes aren't affected. Pick one or more.
      </p>
    </CollapsibleSection>
  )
}
