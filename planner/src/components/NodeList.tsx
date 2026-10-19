import { MAX_NODES, type PlannedNode } from '../settings'
import { Section } from './ui'
import NodeForm from './NodeForm'

interface Props {
  nodes: PlannedNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onChange: (id: string, patch: Partial<PlannedNode>) => void
  /** Start placing a new node: the next map click adds it. */
  onAdd: () => void
  placing: boolean
  onCancelPlacing: () => void
  onUseLocation: () => void
  locating: boolean
  locationError: string | null
  /** Each node's own coverage area, km², once calculated. */
  areas: Record<string, number | undefined>
}

const NETWORK_LABEL = { meshtastic: 'Meshtastic', meshcore: 'MeshCore' } as const

const fmtArea = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1))

export default function NodeList(p: Props) {
  const selected = p.nodes.find((n) => n.id === p.selectedId) ?? null
  const full = p.nodes.length >= MAX_NODES
  const summary = p.nodes.length === 0 ? 'click the map to place' : `${p.nodes.length} node${p.nodes.length === 1 ? '' : 's'}`

  return (
    <Section title="Your network" summary={summary} defaultOpen>
      {p.nodes.length === 0 && <p className="note">Click the map to place your first node, or use your current location.</p>}

      {p.nodes.length > 0 && (
        <ul className="node-list" aria-label="Planned nodes">
          {p.nodes.map((n, i) => {
            const isSel = n.id === p.selectedId
            const area = p.areas[n.id]
            return (
              <li key={n.id} className={`node-card${isSel ? ' selected' : ''}`}>
                <button type="button" className="node-select" aria-pressed={isSel} onClick={() => p.onSelect(n.id)}>
                  <span className="node-badge" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="node-main">
                    <strong>{n.name}</strong>
                    <span className="node-sub">
                      {NETWORK_LABEL[n.network]} · {n.hTxM} m · {n.txPowerDbm} dBm
                    </span>
                  </span>
                  {area !== undefined && <span className="node-area">{fmtArea(area)} km²</span>}
                </button>
                <button type="button" className="node-remove" aria-label={`Remove ${n.name}`} title="Remove this node" onClick={() => p.onRemove(n.id)}>
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="row">
        {p.placing ? (
          <button type="button" className="btn small" onClick={p.onCancelPlacing}>
            Cancel placing
          </button>
        ) : (
          <button type="button" className="btn small" onClick={p.onAdd} disabled={full || p.nodes.length === 0}>
            + Add node
          </button>
        )}
        <button type="button" className="btn small" onClick={p.onUseLocation} disabled={p.locating || full}>
          {p.locating ? 'Locating…' : 'Add at my location'}
        </button>
      </div>
      {p.placing && <div className="hint">Click the map where the next node goes (Esc to cancel).</div>}
      {full && <div className="hint">A plan can hold up to {MAX_NODES} nodes.</div>}
      {p.locationError && <p className="note warn">{p.locationError}</p>}

      {selected && (
        <details className="node-settings" open>
          <summary>Settings for {selected.name}</summary>
          {/* keyed by node, so switching nodes starts every input afresh instead of reusing the last node's text */}
          <NodeForm key={selected.id} node={selected} onChange={(patch) => p.onChange(selected.id, patch)} />
        </details>
      )}
    </Section>
  )
}
