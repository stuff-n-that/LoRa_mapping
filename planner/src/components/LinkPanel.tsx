import { MODE_LABEL, describeWarnings, type DirectionResult } from '../engine/link'
import type { LinkState } from '../hooks'
import type { LinkPlan, LinkWaiting } from '../linkModel'
import { linkPlanKey } from '../linkModel'
import ProfileChart from './ProfileChart'

interface Props {
  plan: LinkPlan | null
  waiting: LinkWaiting | null
  state: LinkState
  cursor: number | null
  onCursor: (i: number | null) => void
  onClose: () => void
}

const WAITING_TEXT: Record<LinkWaiting, string> = {
  'pick-target': 'Click the map to place the other end of the link. You can drag it afterwards.',
  'missing-node': 'One end of this link is no longer in your plan. Close this panel and choose the ends again.',
  'same-node': 'Choose two different nodes.',
}

const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`)
const coords = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`

function Direction({ d }: { d: DirectionResult }) {
  const ok = d.marginDb >= 0
  return (
    <div className="direction">
      <div className="direction-title">{d.label}</div>
      <dl className="stats compact">
        <div>
          <dt>Signal at receiver</dt>
          <dd>{d.receivedDbm.toFixed(1)} dBm</dd>
        </div>
        <div>
          <dt>Receiver needs</dt>
          <dd>{d.sensitivityDbm.toFixed(1)} dBm</dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd className={ok ? 'ok' : 'bad'}>
            {d.marginDb >= 0 ? '+' : ''}
            {d.marginDb.toFixed(1)} dB
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function LinkPanel({ plan, waiting, state, cursor, onCursor, onClose }: Props) {
  const analysis = state.status === 'ready' ? state.analysis : null
  // A result for an older version of the link (an end was just dragged) stays up, marked as updating.
  const updating = !!analysis && !!plan && linkPlanKey(analysis.plan) !== linkPlanKey(plan)
  const shown = analysis?.plan ?? plan

  return (
    <aside className="link-panel" aria-label="Point-to-point link">
      <div className="link-head">
        <h2>Point-to-point link</h2>
        <button type="button" className="btn small ghost" onClick={onClose} aria-label="Close link analysis">
          Close
        </button>
      </div>

      {waiting && <p className="note">{WAITING_TEXT[waiting]}</p>}

      {shown && (
        <div className="ends">
          {[shown.a, shown.b].map((e, i) => (
            <div key={i} className="end">
              <span className="end-badge" aria-hidden="true">
                {i === 0 ? 'A' : 'B'}
              </span>
              <span>
                <strong>{e.name}</strong>
                <span className="end-sub">
                  {e.heightM} m above ground · {coords(e.position)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {plan && !analysis && state.status !== 'error' && (
        <p className="note" role="status">
          Reading the terrain between the two ends…
        </p>
      )}
      {state.status === 'error' && (
        <p className="note warn" role="alert">
          Couldn't analyse this link: {state.message}
        </p>
      )}

      {analysis && (
        <div className={updating ? 'link-body updating' : 'link-body'}>
          <div className={`verdict ${analysis.assessment.verdict}`} role="status">
            {analysis.assessment.headline}
          </div>
          {updating && <div className="hint">Updating…</div>}

          <dl className="stats">
            <div>
              <dt>Distance</dt>
              <dd>{fmtKm(analysis.path.distKm[analysis.path.distKm.length - 1])}</dd>
            </div>
            <div>
              <dt>Path loss</dt>
              <dd>{Number.isFinite(analysis.path.pathLossDb) ? `${analysis.path.pathLossDb.toFixed(1)} dB` : '—'}</dd>
            </div>
            <div>
              <dt>Fresnel clear</dt>
              <dd>{analysis.path.fresnelClearPct.toFixed(0)}%</dd>
            </div>
          </dl>

          {analysis.directions.map((d) => (
            <Direction key={d.label} d={d} />
          ))}

          <ProfileChart path={analysis.path} cursor={cursor} onCursor={onCursor} nameA={analysis.plan.a.name} nameB={analysis.plan.b.name} />

          <ul className="reasons">
            {analysis.assessment.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          {analysis.missingTerrain && <p className="note warn">Some terrain was unavailable and was treated as sea level, so this may be too optimistic.</p>}
          {describeWarnings(analysis.path.warnings).map((w) => (
            <p key={w} className="note">
              {w}
            </p>
          ))}

          <details className="subsection">
            <summary>How this is worked out</summary>
            <p className="note">
              {MODE_LABEL[analysis.path.mode] ?? 'Unknown regime'}. Terrain is sampled every {Math.round(analysis.path.stepM)} m along the path; the chart bends the ground upward in the middle to allow
              for the curve of the earth (effective radius {(analysis.path.effectiveEarthM / 1000).toFixed(0)} km). The path loss is the Longley-Rice (ITM) estimate, the same model as the coverage map.
              The first Fresnel zone is the egg-shaped region around the straight line where obstacles start to weaken the signal; keeping about 60% of it clear is the usual aim.
            </p>
            <p className="note">Antenna heights come from the node settings. For a point on the map, set "Target height above ground" under "Check a link" (it starts from "The receiving device" height). Trees and buildings are not in the terrain data — use the extra-loss allowance.</p>
          </details>
        </div>
      )}
    </aside>
  )
}
