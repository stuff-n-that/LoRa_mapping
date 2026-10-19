import { useMemo, useState } from 'react'
import type { CoverageResult } from '../engine/coverage'
import { MARGIN_BANDS, summarize, type RenderMode } from '../render'
import { CLIMATES, DETAIL_LABELS, GROUND_TYPES, RADIUS_OPTIONS_KM, effectiveSensitivityDbm, type Settings } from '../settings'
import { eirpDbm, maxPathLossDb } from '../engine/radio'
import { linkBudget } from '../settings'
import { Field, Section, Segmented } from './ui'

export interface RunStatus {
  status: 'idle' | 'running' | 'error'
  phase?: 'terrain' | 'compute'
  fraction?: number
  message?: string
}

export interface DisplayOptions {
  opacity: number
  minMargin: number
  mode: RenderMode
}

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  run: RunStatus
  result: CoverageResult | null
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
  const { settings: s, result, run } = p
  const sensitivity = effectiveSensitivityDbm(s)
  const summary = useMemo(() => (result ? summarize(result, sensitivity, p.display.minMargin) : null), [result, sensitivity, p.display.minMargin])
  const [showAssumptions, setShowAssumptions] = useState(false)
  const budget = linkBudget(s)
  const running = run.status === 'running'

  return (
    <Section title="Coverage" summary={result ? `${summary ? fmtKm2(summary.areaKm2) : '–'} km²` : 'not calculated'} defaultOpen>
      <div className="field">
        <span className="label">Range</span>
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
              {run.phase === 'terrain' ? 'Downloading terrain' : 'Calculating coverage'} · {Math.round((run.fraction ?? 0) * 100)}%
            </span>
            <button type="button" className="btn small ghost" onClick={p.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn primary" onClick={p.onCalculate} disabled={!s.node}>
          {result ? (p.stale ? 'Update coverage' : 'Recalculate') : 'Calculate coverage'}
        </button>
      )}
      {!s.node && <div className="hint">Place a node on the map first.</div>}
      {run.status === 'error' && (
        <p className="note warn" role="alert">
          {run.message}
        </p>
      )}

      {result && summary && (
        <div className="result">
          {p.stale && (
            <p className="note warn" role="status">
              Your settings have changed since this was calculated.
            </p>
          )}
          {result.missingTerrainLookups > 0 && (
            <p className="note warn" role="status">
              Some terrain was unavailable and was treated as sea level, so results there may be too optimistic.
            </p>
          )}
          <dl className="stats">
            <div>
              <dt>Predicted coverage</dt>
              <dd>{fmtKm2(summary.areaKm2)} km²</dd>
            </div>
            <div>
              <dt>Furthest reach</dt>
              <dd>{summary.reachKm.toFixed(1)} km</dd>
            </div>
            <div>
              <dt>Strongest margin</dt>
              <dd>{summary.maxMargin.toFixed(0)} dB</dd>
            </div>
          </dl>
          {summary.reachKm >= 0.95 * (result.job.radiusM / 1000) && (
            <p className="note" role="status">
              Coverage reaches the edge of the calculated range. Choose a larger range to see how far it really goes.
            </p>
          )}
          {result.job.budget.extraLossDb === 0 && (
            <p className="note">Terrain only: no allowance for trees or buildings is included. Real coverage is usually smaller — try the extra-loss setting under "The receiving device".</p>
          )}
          <p className="hint">Click the map to read the predicted signal at any point; click the readout to dismiss it. Computed in {(result.elapsedMs / 1000).toFixed(1)} s.</p>

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
              <p>
                Radiated power {eirpDbm(budget).toFixed(1)} dBm · receiver sensitivity {sensitivity.toFixed(1)} dBm · largest tolerable path loss{' '}
                {maxPathLossDb(budget, sensitivity).toFixed(1)} dB.
              </p>
              <p>
                Model: Longley-Rice (ITM) over {Math.round(result.job.demCellM)} m terrain cells, {result.job.reliability}% reliability and confidence, vertical polarisation,{' '}
                {CLIMATES.find((c) => c.id === result.job.climate)?.label.toLowerCase()} climate, {GROUND_TYPES.find((g) => g.epsilon === result.job.epsilon && g.sigma === result.job.sigma)?.label.toLowerCase()}.
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
