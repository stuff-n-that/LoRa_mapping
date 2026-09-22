import { useRef } from 'react'

export default function Toolbar({ pickMode, onStartPick, onCancelPick, onImport, onExport, onReset, nodeCount }) {
  const fileInputRef = useRef(null)

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) onImport(file)
    e.target.value = ''
  }

  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <span>LoRa Mesh Map</span>
        <span className="toolbar-count">{nodeCount} nodes</span>
      </div>

      {pickMode ? (
        <div className="toolbar-hint">
          Tap the map to place the node
          <button className="btn-secondary" onClick={onCancelPick}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="toolbar-actions">
          <button className="btn-primary" onClick={onStartPick}>
            + Add node
          </button>
          <button className="btn-secondary" onClick={handleImportClick}>
            Import
          </button>
          <button className="btn-secondary" onClick={onExport}>
            Export
          </button>
          <button className="btn-secondary" onClick={onReset}>
            Reset sample data
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  )
}
