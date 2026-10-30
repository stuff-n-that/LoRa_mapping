import { useRef, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { MAX_LAYERS, OVERLAY_COLORS, droppedOverlayFile, readOverlayFile } from '../utils/localOverlays'

export default function LocalOverlayPanel({ layers, onChange, onZoom, counts, view, onViewChange, publicCount, onImportComplete }) {
  const input = useRef(null)
  const replacing = useRef(null)
  const importing = useRef(false)
  const dragDepth = useRef(0)
  const [collapsed, setCollapsed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const total = layers.reduce((sum, l) => sum + l.nodes.length, 0)
  const summary = layers.length ? `${layers.length} ${layers.length === 1 ? 'file' : 'files'} · ${total.toLocaleString()} ${total === 1 ? 'position' : 'positions'}` : 'none imported'

  function choose(id = null) {
    replacing.current = id
    input.current.click()
  }

  async function importFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    await loadFile(file, replacing.current)
  }

  async function loadFile(file, replacementId = null) {
    if (!file || importing.current) return
    importing.current = true
    setError(''); setBusy(true)
    try {
      if (!replacementId && layers.length >= MAX_LAYERS) throw new Error(`Up to ${MAX_LAYERS} overlays can be loaded. Remove or replace a layer first.`)
      const parsed = await readOverlayFile(file)
      const previous = layers.find(l => l.id === replacementId)
      const layer = { ...parsed, id: previous?.id || crypto.randomUUID(), enabled: previous?.enabled ?? true, color: previous?.color || OVERLAY_COLORS[layers.length % OVERLAY_COLORS.length] }
      onChange(previous ? layers.map(l => l.id === previous.id ? layer : l) : [...layers, layer])
      if (layers.length === 0) onZoom(layer)
      const message = `${parsed.nodes.length} ${parsed.nodes.length === 1 ? 'position' : 'positions'} imported · ${parsed.report.noPosition} without coordinates · ${parsed.report.invalid} invalid${parsed.report.duplicates ? ` · ${parsed.report.duplicates} duplicates` : ''}.`
      setNotice(message)
      onViewChange('all')
      setCollapsed(true)
      onImportComplete(message)
    } catch (err) {
      setError(err.message || 'Could not read this file. Existing layers have been kept.')
    } finally { importing.current = false; setBusy(false) }
  }

  function dragEnter(event) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepth.current++
    if (!importing.current) setDragging(true)
  }

  function dragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function dragOver(event) {
    event.preventDefault()
    event.dataTransfer.dropEffect = importing.current ? 'none' : 'copy'
  }

  async function drop(event) {
    // Stop the browser navigating to a dropped file, including while reading.
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    if (importing.current) return
    try {
      const file = droppedOverlayFile(event.dataTransfer)
      // A drop adds a layer; it never inherits an earlier Replace action.
      replacing.current = null
      await loadFile(file)
    } catch (err) { setError(err.message) }
  }

  function update(id, patch) { onChange(layers.map(l => l.id === id ? { ...l, ...patch } : l)) }
  return <div className="local-overlays">
    <input ref={input} type="file" accept=".json,.geojson,application/json,application/geo+json" aria-label="Local overlay file" hidden onChange={importFile} />
    <CollapsibleSection title="Your local overlays" summary={summary} collapsed={collapsed} onCollapsedChange={setCollapsed}>
      <div className={`overlay-dropzone${dragging ? ' is-dragging' : ''}`} onDragEnter={dragEnter} onDragLeave={dragLeave} onDragOver={dragOver} onDrop={drop}>
        <button type="button" className="overlay-button overlay-import" aria-label="Import local file" aria-busy={busy} disabled={busy} onClick={() => choose()}>
          <span className="overlay-drop-desktop">{busy ? 'Reading file…' : dragging ? 'Drop to import' : 'Drop a file here'}</span>
          <span className="overlay-drop-browse">{busy ? 'Please wait' : 'Browse files'}</span>
        </button>
      </div>
      <p className="overlay-note">MeshCore/Meshtastic JSON or point GeoJSON · up to 5 MB. Files stay in this browser tab and disappear on refresh.</p>
      <div className="overlay-list">
        {layers.map(layer => <div className="overlay-card" key={layer.id}>
          <div className="overlay-row">
            <label className="overlay-toggle"><input type="checkbox" checked={layer.enabled} onChange={e => update(layer.id, { enabled: e.target.checked })} /><span>{layer.name}</span></label>
            <input type="color" value={layer.color} aria-label={`Colour for ${layer.name}`} onChange={e => update(layer.id, { color: e.target.value })} />
          </div>
          <div className="overlay-note">{layer.nodes.length.toLocaleString()} positions · {layer.filename}</div>
          <div className="overlay-note">Captured: {layer.capturedAt ? new Date(layer.capturedAt).toLocaleString() : 'not supplied'}</div>
          <div className="overlay-actions">
            <button className="overlay-button" type="button" onClick={() => { onZoom(layer); setCollapsed(true); onImportComplete() }}>Zoom to</button>
            <button className="overlay-button" type="button" disabled={busy} onClick={() => choose(layer.id)}>Replace</button>
            <button className="overlay-button" type="button" disabled={busy} onClick={() => { onChange(layers.filter(l => l.id !== layer.id)); onViewChange('all'); setNotice('Overlay removed from this tab.') }}>Remove</button>
          </div>
          <details className="overlay-details"><summary>View import details</summary>
            <p>{layer.format}. {layer.report.total} records; {layer.report.noPosition} without coordinates; {layer.report.invalid} invalid; {layer.report.duplicates} duplicate identities.</p>
            {layer.report.noIdentity > 0 && <p>{layer.report.noIdentity} positions have no supported identity and cannot be compared by key.</p>}
            {layer.report.details.length > 0 && <ul>{layer.report.details.slice(0, 50).map((d, i) => <li key={i}>{d.name}: {d.reason}</li>)}</ul>}
            {layer.report.details.length > 50 && <p>Showing the first 50 omitted or duplicate records.</p>}
          </details>
        </div>)}
      </div>
      {layers.length > 0 && <div className="overlay-comparison">
        <label htmlFor="overlay-view">Compare with loaded public data</label>
        <select id="overlay-view" value={view} onChange={e => onViewChange(e.target.value)}>
          <option value="all">All sources</option><option value="both">Both sources ({counts.both})</option>
          <option value="local-only">Local only ({counts.localOnly})</option><option value="public-only">Public only ({counts.publicOnly})</option>
        </select>
        <p className="overlay-note">{publicCount ? 'Matches use MeshCore public keys or Meshtastic node IDs in loaded regions.' : 'Select a public node-data region to compare.'} Counts use enabled layers and the node-type filter. Unsupported identities appear in All sources only. Public-only does not mean unheard or offline.</p>
        <p className="overlay-note">Solid colour: local only or unmatchable. Ring: both sources. Dashed line: positions differ by over 100 m. Stored contacts do not confirm current reachability.</p>
      </div>}
    </CollapsibleSection>
    {notice && <p className="overlay-notice" role="status">{notice}</p>}
    {error && <p className="overlay-error" role="alert">{error}</p>}
  </div>
}
