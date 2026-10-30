import CollapsibleSection from './CollapsibleSection'
import LocalOverlayPanel from './LocalOverlayPanel'

const BASE_LAYER_OPTIONS = [
  { key: 'streets', label: 'Streets (OpenStreetMap)' },
  { key: 'satellite', label: 'Satellite (Esri World Imagery)' },
  { key: 'terrain', label: 'Terrain (OpenTopoMap)' },
]

export default function MapLayersPanel({
  baseLayer,
  onBaseLayerChange,
  showMeshcore,
  showMeshtastic,
  onToggleMeshcore,
  onToggleMeshtastic,
  localOverlays,
  onLocalOverlaysChange,
  onOverlayZoom,
  comparisonCounts,
  comparisonView,
  onComparisonViewChange,
  publicCount,
  collapsed,
  onCollapsedChange,
  onImportComplete,
}) {
  const baseLabel = BASE_LAYER_OPTIONS.find((o) => o.key === baseLayer)?.label.split(' ')[0] || 'Streets'
  const overlayCount = [showMeshcore, showMeshtastic].filter(Boolean).length
  const summary = `${baseLabel} · ${overlayCount}/2 public${localOverlays.length ? ` · ${localOverlays.length} local ${localOverlays.length === 1 ? 'file' : 'files'}` : ''}`

  return (
    <CollapsibleSection title="Map layers" summary={summary} className="layers-panel" collapsed={collapsed} onCollapsedChange={onCollapsedChange}>
      <div className="layers-group">
        <div className="layers-group-label">Base map</div>
        {BASE_LAYER_OPTIONS.map(({ key, label }) => (
          <label key={key} className="layers-item">
            <input type="radio" name="base-layer" checked={baseLayer === key} onChange={() => onBaseLayerChange(key)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="layers-group">
        <div className="layers-group-label">Public map data</div>
        <label className="layers-item">
          <input type="checkbox" checked={showMeshcore} onChange={(e) => onToggleMeshcore(e.target.checked)} />
          <span>MeshCore nodes</span>
        </label>
        <label className="layers-item">
          <input type="checkbox" checked={showMeshtastic} onChange={(e) => onToggleMeshtastic(e.target.checked)} />
          <span>Meshtastic nodes</span>
        </label>
      </div>
      <LocalOverlayPanel layers={localOverlays} onChange={onLocalOverlaysChange} onZoom={onOverlayZoom}
        counts={comparisonCounts} view={comparisonView} onViewChange={onComparisonViewChange}
        publicCount={publicCount} onImportComplete={onImportComplete} />
    </CollapsibleSection>
  )
}
