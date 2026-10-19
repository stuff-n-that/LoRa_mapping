import { useMemo, useState } from 'react'
import { eirpDbm, maxPathLossDb } from '../engine/radio'
import type { GridGeometry } from '../engine/coverage'
import { cellSizeM, reachKm, summarizeMargins, type NetworkResult, type NodeResult } from '../network'
import { MARGIN_BANDS, type RenderMode } from '../render'
import { CLIMATES, DETAIL_LABELS, GROUND_TYPES, RADIUS_OPTIONS_KM, linkBudget, type PlannedNode, type Settings } from '../settings'
import { Field, NumberField, Section, Segmented } from './ui'

export interface RunStatus {
  status: 'idle' | 'running' | 'error'
  phase?: 'terrain' | 'compute'
  /** 0..1 across the whole run. */
  fraction?: number
  /** Which node (1-based) is being calculated, of how many. */
  node?: number
  count?: number
  message?: string
}

export interface DisplayOptions {
  opacity: number
  minMargin: number
  mode: RenderMode
  /** 'all' shows the combined network, or the id of one node. */
  view: string
}

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  run: RunStatus
  network: NetworkResult | null
  /** The nodes in the current view (all of them, or just the chosen one), still part of the plan. */
  shown: NodeResult[]
  /** Current sensitivity per node id, dBm. */
  sensitivity: Record<string, number>
  /** Sensitivity the selected node would use, offered when switching to a manual value. */
  defaultSensitivity: number | null
  margins: Float32Array | null
  geom: GridGeometry | null
  stale: boolean
  onCalculate: () => void
  onCancel: () => void
  display: DisplayOptions
  onDisplayChange: (d: DisplayOptions) => void
  onShare: () => void
  shareState: 'idle' | 'copied' | 'failed'
}

export function Legend({ minMargin }: { minMargin: number }) {
  return (
    <div className="legend" role="group" aria-label="Signal margin legend">
      <div className="legend-title">Signal above receiver sensitivity</div>
      <ul>
        {MARGIN_BANDS.map((b, i) => {
          const next = MARGIN_BANDS[i + 1]
          const dimmed = next && next.from <= minMargin
          return (
            <li key={b.label} className={dimmed ? 'dim' : ''}>
              <span className="swatch" style={{ background: b.color }} /> {b.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const fmtKm2 = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1))

export default function ResultPanel(p: Props) {
  const { settings: s, network, run } = p
  const nodes = s.nodes
  const running = run.status === 'running'
  const [showAssumptions, setShowAssumptions] = useState(false)

  const summary = useMemo(() => (p.margins && p.geom ? summarizeMargins(p.margins, p.geom, p.display.minMargin) : null), [p.margins, p.geom, p.display.minMargin])

  // The furthest any shown node still reaches (from that node), to tell the user when the range clips the result.
  const furthest = useMemo(() => {
    let far = 0
    for (const n of p.shown) far = Math.max(far, reachKm(n.result, p.sensitivity[n.id], p.display.minMargin))
    return far
  }, [p.shown, p.sensitivity, p.display.minMargin])

  const single = p.shown.length === 1
  const hasResult = !!network && p.shown.length > 0 && !!summary
  const coarse = hasResult && p.geom ? cellSizeM(p.geom) > 1.2 * p.shown[0].result.job.outCellM : false
  const label = running ? '' : network ? (p.stale ? 'Update coverage' : 'Recalculate') : nodes.length > 1 ? `Calculate coverage for ${nodes.length} nodes` : 'Calculate coverage'

  return (
    <Section title="Coverage" summary={hasResult && summary ? `${fmtKm2(summary.areaKm2)} km²` : 'not calculated'} defaultOpen>
      <div className="field">
        <span className="label">Range (from each node)</span>
        <Segmented label="Range" value={s.radiusKm} onChange={(radiusKm) => p.onChange({ radiusKm })} options={RADIUS_OPTIONS_KM.map((k) => ({ id: k, label: `${k} km` }))} />
      </div>
      <div className="field">
        <span className="label">Detail</span>
        <Segmented label="Detail" value={s.detail} onChange={(detail) => p.onChange({ detail })} options={DETAIL_LABELS} />
        <div className="hint">Finer detail follows the terrain more closely but takes longer.</div>
      </div>
      <div className="field">
        <span className="label">Plan for</span>
        <Segmented
          label="Reliability"
          value={s.reliability}
          onChange={(reliability) => p.onChange({ reliability })}
          options={[
            { id: 50, label: 'Typical (50%)' },
            { id: 90, label: 'Cautious (90%)' },
          ]}
        />
        <div className="hint">Cautious allows for about 10 dB more loss than a typical case (unlucky siting, weather, hardware), so it shows less coverage.</div>
      </div>

      <details className="subsection">
        <summary>The receiving device (all nodes)</summary>
        <p className="note">Coverage shows where a device like this could hear your nodes.</p>
        <div className="row">
          <Field label="Height above ground">{(id) => <NumberField id={id} value={s.hRxM} min={0.5} max={100} step={0.5} decimals={1} unit="m" onChange={(hRxM) => p.onChange({ hRxM })} />}</Field>
          <Field label="Antenna gain">{(id) => <NumberField id={id} value={s.rxGainDbi} min={-10} max={25} step={0.1} decimals={1} unit="dBi" onChange={(rxGainDbi) => p.onChange({ rxGainDbi })} />}</Field>
        </div>
        <div className="row">
          <Field label="Cable loss">{(id) => <NumberField id={id} value={s.rxCableLossDb} min={0} max={20} step={0.1} decimals={1} unit="dB" onChange={(rxCableLossDb) => p.onChange({ rxCableLossDb })} />}</Field>
          <Field label="Extra loss allowance" hint="Foliage, buildings, enclosures — things the model can't see. Your own estimate.">
            {(id) => <NumberField id={id} value={s.extraLossDb} min={0} max={60} step={1} unit="dB" onChange={(extraLossDb) => p.onChange({ extraLossDb })} />}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.sensitivityOverride !== null} onChange={(e) => p.onChange({ sensitivityOverride: e.target.checked ? Math.round(p.defaultSensitivity ?? -130) : null })} /> Set receiver sensitivity manually
        </label>
        {s.sensitivityOverride !== null && (
          <Field label="Receiver sensitivity (every node)">
            {(id) => <NumberField id={id} value={s.sensitivityOverride as number} min={-160} max={-60} step={0.5} decimals={1} unit="dBm" onChange={(sensitivityOverride) => p.onChange({ sensitivityOverride })} />}
          </Field>
        )}
      </details>

      <details className="subsection">
        <summary>Environment</summary>
        <Field label="Climate">
          {(id) => (
            <select id={id} value={s.climate} onChange={(e) => p.onChange({ climate: Number(e.target.value) })}>
              {CLIMATES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Ground">
          {(id) => (
            <select id={id} value={s.groundId} onChange={(e) => p.onChange({ groundId: e.target.value })}>
              {GROUND_TYPES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </details>

      {running ? (
        <div className="progress" role="status" aria-live="polite">
          <div className="bar">
            <div style={{ width: `${Math.round((run.fraction ?? 0) * 100)}%` }} />
          </div>
          <div className="row between">
            <span>
              {run.count && run.count > 1 ? `Node ${run.node} of ${run.count} · ` : ''}
              {run.phase === 'terrain' ? 'Downloading terrain' : 'Calculating coverage'} · {Math.round((run.fraction ?? 0) * 100)}%
            </span>
            <button type="button" className="btn small ghost" onClick={p.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn primary" onClick={p.onCalculate} disabled={nodes.length === 0}>
          {label}
        </button>
      )}
      {nodes.length === 0 && <div className="hint">Place a node on the map first.</div>}
      {run.status === 'error' && (
        <p className="note warn" role="alert">
          {run.message}
        </p>
      )}

      {hasResult && summary && network && (
        <div className="result">
          {p.stale && (
            <p className="note warn" role="status">
              Your plan or settings have changed since this was calculated.
            </p>
          )}
          {network.nodes.some((n) => n.result.missingTerrainLookups > 0) && (
            <p className="note warn" role="status">
              Some terrain was unavailable and was treated as sea level, so results there may be too optimistic.
            </p>
          )}
          {coarse && (
            <p className="note" role="status">
              To keep the map a workable size it is drawn in coarser pixels than the detail setting asks for (a wide area, or nodes far apart). A smaller range or finer-spaced nodes give more detail.
            </p>
          )}
          {nodes.length > 1 && (
            <Field label="Show">
              {(id) => (
                <select id={id} value={p.display.view} onChange={(e) => p.onDisplayChange({ ...p.display, view: e.target.value })}>
                  <option value="all">All nodes combined</option>
                  {network.nodes
                    .filter((n) => nodes.some((x) => x.id === n.id))
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {nodes.find((x) => x.id === n.id)?.name ?? n.name} only
                      </option>
                    ))}
                </select>
              )}
            </Field>
          )}
          {furthest >= 0.95 * s.radiusKm && (
            <p className="note" role="status">
              Coverage reaches the edge of the calculated range. Choose a larger range to see how far it really goes.
            </p>
          )}
          {network.nodes.every((n) => n.result.job.budget.extraLossDb === 0) && (
            <p className="note">Terrain only: no allowance for trees or buildings is included. Real coverage is usually smaller — try the extra-loss setting under "The receiving device".</p>
          )}
          <dl className="stats">
            <div>
              <dt>{single ? 'Predicted coverage' : 'Combined coverage'}</dt>
              <dd>{fmtKm2(summary.areaKm2)} km²</dd>
            </div>
            <div>
              <dt>{single ? 'Furthest reach' : 'Nodes shown'}</dt>
              <dd>{single ? `${furthest.toFixed(1)} km` : p.shown.length}</dd>
            </div>
            <div>
              <dt>Strongest margin</dt>
              <dd>{summary.maxMargin.toFixed(0)} dB</dd>
            </div>
          </dl>
          <p className="hint">Click the map to read the predicted signal at any point; click the readout to dismiss it. Computed in {(network.elapsedMs / 1000).toFixed(1)} s.</p>

          <div className="field">
            <label htmlFor="opacity">Overlay opacity</label>
            <input id="opacity" type="range" min={0.2} max={1} step={0.05} value={p.display.opacity} onChange={(e) => p.onDisplayChange({ ...p.display, opacity: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="minmargin">Show only where margin is at least {p.display.minMargin} dB</label>
            <input id="minmargin" type="range" min={0} max={30} step={1} value={p.display.minMargin} onChange={(e) => p.onDisplayChange({ ...p.display, minMargin: Number(e.target.value) })} />
          </div>
          <div className="field">
            <span className="label">Style</span>
            <Segmented
              label="Style"
              value={p.display.mode}
              onChange={(mode) => p.onDisplayChange({ ...p.display, mode })}
              options={[
                { id: 'smooth', label: 'Smooth' },
                { id: 'bands', label: 'Bands' },
              ]}
            />
          </div>

          <div className="row">
            <button type="button" className="btn small" onClick={p.onShare}>
              {p.shareState === 'copied' ? 'Link copied' : p.shareState === 'failed' ? 'Copy the address bar' : 'Copy link to this plan'}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setShowAssumptions((v) => !v)} aria-expanded={showAssumptions}>
              {showAssumptions ? 'Hide' : 'Show'} assumptions
            </button>
          </div>

          {showAssumptions && (
            <div className="assumptions">
              {p.shown.map((n) => {
                const node = nodes.find((x) => x.id === n.id) as PlannedNode | undefined
                if (!node) return null
                const budget = linkBudget(node, s)
                return (
                  <p key={n.id}>
                    <strong>{node.name}:</strong> radiated power {eirpDbm(budget).toFixed(1)} dBm · receiver sensitivity {p.sensitivity[n.id].toFixed(1)} dBm · largest tolerable path loss{' '}
                    {maxPathLossDb(budget, p.sensitivity[n.id]).toFixed(1)} dB.
                  </p>
                )
              })}
              <p>
                Model: Longley-Rice (ITM) over {Math.round(network.nodes[0].result.job.demCellM)} m terrain cells, {network.nodes[0].result.job.reliability}% reliability and confidence, vertical polarisation,{' '}
                {CLIMATES.find((c) => c.id === network.nodes[0].result.job.climate)?.label.toLowerCase()} climate,{' '}
                {GROUND_TYPES.find((g) => g.epsilon === network.nodes[0].result.job.epsilon && g.sigma === network.nodes[0].result.job.sigma)?.label.toLowerCase()}.
                {nodes.length > 1 && ' With several nodes, each point shows the strongest margin of any node.'}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="disclaimer">
        <strong>An estimate, not a promise.</strong> The model uses terrain height only. It does not see buildings, trees, weather, interference or how your antenna is
        actually mounted — use the extra-loss setting for those. Real results vary; test before you commit to a deployment.
      </div>
    </Section>
  )
}
