import { useState } from 'react'
import { TARGET_HEIGHT_RANGE, type LinkSpec, type LinkTarget, type PlannedNode } from '../settings'
import { Field, NumberField, Section } from './ui'

interface Props {
  nodes: PlannedNode[]
  link: LinkSpec | null
  /** The node to start from when a link is first opened. */
  defaultFromId: string | null
  /** The shared "receiving device" height, used for a point target until the link sets its own. */
  defaultTargetHeightM: number
  onChange: (link: LinkSpec | null) => void
}

const POINT = 'point'

export default function LinkSetup({ nodes, link, defaultFromId, defaultTargetHeightM, onChange }: Props) {
  // Choices made before the link is opened live here; once it is open the plan holds them.
  const [draftFrom, setDraftFrom] = useState<string | null>(null)
  const [draftTo, setDraftTo] = useState(POINT)
  const [draftHeightM, setDraftHeightM] = useState<number | null>(null)
  const draftOk = draftFrom && nodes.some((n) => n.id === draftFrom) ? draftFrom : null
  const fromId = link?.from ?? draftOk ?? defaultFromId ?? nodes[0]?.id ?? ''
  const toValue = link ? (link.to.kind === 'node' ? link.to.id : POINT) : nodes.some((n) => n.id === draftTo && n.id !== fromId) ? draftTo : POINT
  const others = nodes.filter((n) => n.id !== fromId)
  const linkHeightM = link?.to.kind === 'point' ? link.to.heightM : undefined
  const targetHeightM = linkHeightM ?? draftHeightM ?? defaultTargetHeightM
  /** A point target as it should be created now, carrying any height chosen so far. */
  const newPoint = (): LinkTarget => ({ kind: 'point', position: null, ...(draftHeightM === null ? {} : { heightM: draftHeightM }) })

  const setFrom = (id: string) => {
    if (!link) return setDraftFrom(id)
    // keep the far end, unless it is now the same node
    const to = link.to.kind === 'node' && link.to.id === id ? newPoint() : link.to
    onChange({ from: id, to })
  }
  const setTo = (value: string) => {
    if (!link) return setDraftTo(value)
    const to: LinkTarget = value === POINT ? newPoint() : { kind: 'node', id: value }
    onChange({ from: fromId, to })
  }
  const setTargetHeight = (heightM: number) => {
    setDraftHeightM(heightM)
    if (link?.to.kind === 'point') onChange({ ...link, to: { ...link.to, heightM } })
  }

  return (
    <Section title="Check a link" summary={link ? 'open on the right' : undefined}>
      {nodes.length === 0 ? (
        <p className="note">Place a node first, then check how well it reaches a spot or another node.</p>
      ) : (
        <>
          <p className="note">See the terrain between two ends, whether anything blocks the path, and the signal each way.</p>
          <div className="field">
            <label htmlFor="link-from">From</label>
            <select id="link-from" value={fromId} onChange={(e) => setFrom(e.target.value)}>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="link-to">To</label>
            <select id="link-to" value={toValue} onChange={(e) => setTo(e.target.value)}>
              <option value={POINT}>A point on the map</option>
              {others.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          {toValue === POINT && (
            <Field label="Target height above ground" hint="How high the antenna is at the far end. Starts from the receiving device height; change it here for this link only.">
              {(id) => <NumberField id={id} value={targetHeightM} min={TARGET_HEIGHT_RANGE.min} max={TARGET_HEIGHT_RANGE.max} step={0.5} decimals={1} unit="m" onChange={setTargetHeight} />}
            </Field>
          )}
          <div className="row">
            {link ? (
              <button type="button" className="btn small ghost" onClick={() => onChange(null)}>
                Close link analysis
              </button>
            ) : (
              <button type="button" className="btn small primary" onClick={() => onChange({ from: fromId, to: toValue === POINT ? newPoint() : { kind: 'node', id: toValue } })}>
                Check this link
              </button>
            )}
          </div>
        </>
      )}
    </Section>
  )
}
