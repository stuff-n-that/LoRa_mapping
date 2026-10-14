import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'

// Same breakpoint as .panels-drawer in App.css. Unlike the other panels,
// Measure skips the collapse-by-default dropdown on mobile — you're
// actively watching the live distance/radius readout while dragging on a
// touch screen, so it needs to already be visible, not one more tap away.
const MOBILE_QUERY = '(max-width: 520px)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const handler = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isMobile
}

function hintFor(mode, stage) {
  if (mode === 'none') return 'Pick a tool, then click two points on the map.'
  if (stage === 'idle') return mode === 'line' ? 'Click the map to place the start point.' : 'Click the map to place the center.'
  if (stage === 'drawing') return mode === 'line' ? 'Move the mouse, then click to set the end point.' : 'Move the mouse, then click to set the radius.'
  return 'Drag the yellow point(s) to adjust, or click the map to start a new measurement.'
}

export default function MeasurePanel({ mode, onModeChange, stage, resultText }) {
  const isMobile = useIsMobile()
  const summary = mode === 'none' ? 'off' : resultText || (mode === 'line' ? 'measuring distance' : 'measuring radius')

  const body = (
    <>
      <div className="measure-tools">
        <button
          type="button"
          className={`measure-tool-btn${mode === 'line' ? ' active' : ''}`}
          onClick={() => onModeChange(mode === 'line' ? 'none' : 'line')}
        >
          Distance
        </button>
        <button
          type="button"
          className={`measure-tool-btn${mode === 'circle' ? ' active' : ''}`}
          onClick={() => onModeChange(mode === 'circle' ? 'none' : 'circle')}
        >
          Radius
        </button>
      </div>
      {mode !== 'none' && (
        <div className="measure-status">
          {resultText && <div className="measure-result">{resultText}</div>}
          <div className="measure-hint">{hintFor(mode, stage)}</div>
        </div>
      )}
    </>
  )

  if (isMobile) {
    return (
      <div className="measure-panel measure-panel-static">
        <div className="panel-header-title">Measure</div>
        <div className="panel-body">{body}</div>
      </div>
    )
  }

  return (
    <CollapsibleSection title="Measure" summary={summary} className="measure-panel">
      {body}
    </CollapsibleSection>
  )
}
