function hintFor(mode, stage) {
  if (mode === 'none') return 'Pick a tool, then click two points on the map.'
  if (stage === 'idle') return mode === 'line' ? 'Click the map to place the start point.' : 'Click the map to place the center.'
  if (stage === 'drawing') return mode === 'line' ? 'Move the mouse, then click to set the end point.' : 'Move the mouse, then click to set the radius.'
  return 'Drag the yellow point(s) to adjust, or click the map to start a new measurement.'
}

// Unlike the other panels, Measure is never a collapse-to-a-summary-line
// dropdown — on any screen size, at any width or orientation. You're
// watching the live distance/radius readout while dragging, so it has to
// already be on screen, not a tap away behind a chevron. (An earlier
// version tried to detect "mobile" via a width media query and collapse
// only on desktop; that kept disagreeing with real devices, so this
// version just never collapses, full stop — nothing to get wrong.)
export default function MeasurePanel({ mode, onModeChange, stage, resultText }) {
  const summary = mode === 'none' ? 'off' : resultText || (mode === 'line' ? 'measuring distance' : 'measuring radius')

  return (
    <div className="measure-panel">
      <div className="panel-header-title">
        Measure<span className="panel-header-summary"> · {summary}</span>
      </div>
      <div className="panel-body">
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
      </div>
    </div>
  )
}
