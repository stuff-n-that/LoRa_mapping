import CollapsibleSection from './CollapsibleSection'

function hintFor(mode, stage) {
  if (mode === 'none') return 'Pick a tool, then click two points on the map.'
  if (stage === 'idle') return mode === 'line' ? 'Click the map to place the start point.' : 'Click the map to place the center.'
  if (stage === 'drawing') return mode === 'line' ? 'Move the mouse, then click to set the end point.' : 'Move the mouse, then click to set the radius.'
  return 'Drag the yellow point(s) to adjust, or click the map to start a new measurement.'
}

export default function MeasurePanel({ mode, onModeChange, stage, resultText }) {
  const summary = mode === 'none' ? 'off' : resultText || (mode === 'line' ? 'measuring distance' : 'measuring radius')

  return (
    <CollapsibleSection title="Measure" summary={summary} className="measure-panel">
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
    </CollapsibleSection>
  )
}
