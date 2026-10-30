import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Toolbar from './components/Toolbar'
import MapLayersPanel from './components/MapLayersPanel'
import RegionPicker from './components/RegionPicker'
import NodeTypeFilter from './components/NodeTypeFilter'
import MeasurePanel from './components/MeasurePanel'
import { ROLE_CATEGORIES } from './utils/nodeRoles'
import { loadNodes, persistNodes } from './utils/nodeStore'
import { plannerUrl } from './utils/plannerLink'
import { compareOverlays, identity } from './utils/localOverlays'
import './App.css'

export default function App() {
  const [nodes, setNodes] = useState(() => loadNodes())
  const [snapshotNodes, setSnapshotNodes] = useState([])
  const [selectedRegionCount, setSelectedRegionCount] = useState(0)
  const [selectedRegionCodes, setSelectedRegionCodes] = useState([])
  const [enabledRoleCategories, setEnabledRoleCategories] = useState(
    () => new Set(ROLE_CATEGORIES.map((c) => c.key)),
  )
  const [baseLayer, setBaseLayer] = useState('streets')
  const [showMeshcore, setShowMeshcore] = useState(true)
  const [showMeshtastic, setShowMeshtastic] = useState(true)
  // Local imports are deliberately held only in React memory, never persisted.
  const [localOverlays, setLocalOverlays] = useState([])
  const [comparisonView, setComparisonView] = useState('all')
  const [layersCollapsed, setLayersCollapsed] = useState(true)
  const [overlayZoom, setOverlayZoom] = useState(null)
  const [importNotice, setImportNotice] = useState(null)
  const [measureMode, setMeasureMode] = useState('none')
  const [measureInfo, setMeasureInfo] = useState({ stage: 'idle', text: null })
  // Only affects layout below the mobile breakpoint (see .panels-drawer in
  // App.css) — above it the panel stack is always visible and this button
  // is hidden, so the two states can never disagree.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  function handleRegionLoaded(regionNodes) {
    setSnapshotNodes(regionNodes)
  }

  const allNodes = useMemo(() => [...nodes, ...snapshotNodes], [nodes, snapshotNodes])

  // Only nodes that actually carry a role category (snapshot network data)
  // are subject to this filter — manually added nodes have no roleCategory
  // field at all and always pass through untouched.
  const visibleNodes = useMemo(
    () => allNodes.filter((n) => !n.roleCategory || enabledRoleCategories.has(n.roleCategory)),
    [allNodes, enabledRoleCategories],
  )
  const filteredLocal = useMemo(() => localOverlays.map(l => ({ ...l, nodes: l.nodes.filter(n => enabledRoleCategories.has(n.roleCategory)) })), [localOverlays, enabledRoleCategories])
  const comparison = useMemo(() => compareOverlays(visibleNodes, filteredLocal, comparisonView), [visibleNodes, filteredLocal, comparisonView])
  const shownPublicNodes = comparison.publicNodes.filter(n => n.network === 'meshcore' ? showMeshcore : showMeshtastic)
  const shownCount = new Set([
    ...shownPublicNodes.map(n => identity(n) || n.id),
    ...comparison.localLayers.flatMap(l => l.nodes.map(n => identity(n) || `${l.id}:${n.id}`)),
  ]).size

  function finishImport(message) {
    // Reclaim map space after the native file picker, especially on mobile.
    setLayersCollapsed(true)
    setMobileMenuOpen(false)
    if (message) setImportNotice({ message })
  }

  function changeLocalOverlays(layers) {
    // Release any old fit-to-layer reference when a file is replaced or removed.
    setOverlayZoom(null)
    setLocalOverlays(layers)
  }

  useEffect(() => {
    if (!importNotice) return
    const timer = setTimeout(() => setImportNotice(null), 10000)
    return () => clearTimeout(timer)
  }, [importNotice])

  useEffect(() => {
    persistNodes(nodes)
  }, [nodes])

  function handleDeleteNode(id) {
    setNodes((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <div className="app">
      <div className="top-stack">
        <Toolbar
          nodeCount={shownCount}
          selectedRegionCount={selectedRegionCount}
          plannerHref={plannerUrl({ regions: selectedRegionCodes })}
          menuOpen={mobileMenuOpen}
          onToggleMenu={() => setMobileMenuOpen((open) => !open)}
        />
        <div className={`panels-drawer${mobileMenuOpen ? '' : ' panels-drawer-closed'}`}>
          <MapLayersPanel
            baseLayer={baseLayer}
            onBaseLayerChange={setBaseLayer}
            showMeshcore={showMeshcore}
            showMeshtastic={showMeshtastic}
            onToggleMeshcore={setShowMeshcore}
            onToggleMeshtastic={setShowMeshtastic}
            localOverlays={localOverlays}
            onLocalOverlaysChange={changeLocalOverlays}
            onOverlayZoom={layer => setOverlayZoom({ nodes: layer.nodes })}
            comparisonCounts={comparison.counts}
            comparisonView={comparisonView}
            onComparisonViewChange={setComparisonView}
            publicCount={snapshotNodes.length}
            collapsed={layersCollapsed}
            onCollapsedChange={setLayersCollapsed}
            onImportComplete={finishImport}
          />
          <RegionPicker
            onNodesLoaded={handleRegionLoaded}
            onSelectionCountChange={setSelectedRegionCount}
            onSelectedCodesChange={setSelectedRegionCodes}
          />
          <NodeTypeFilter enabledCategories={enabledRoleCategories} onChange={setEnabledRoleCategories} />
        </div>
        {/* Outside .panels-drawer on purpose: the drawer is hidden behind
            the ☰ button below the mobile breakpoint, but Measure needs to
            stay visible while you're dragging a point on the map, so it
            can't be behind that same toggle. */}
        <MeasurePanel mode={measureMode} onModeChange={setMeasureMode} stage={measureInfo.stage} resultText={measureInfo.text} />
      </div>

      <MapView
        nodes={comparison.publicNodes}
        localOverlays={comparison.localLayers}
        overlayZoom={overlayZoom}
        onDeleteNode={handleDeleteNode}
        baseLayer={baseLayer}
        showMeshcore={showMeshcore}
        showMeshtastic={showMeshtastic}
        measureMode={measureMode}
        onMeasureChange={setMeasureInfo}
        plannerRegions={selectedRegionCodes}
      />
      {importNotice && <div className="overlay-toast" role="status"><span>{importNotice.message}</span><button type="button" aria-label="Dismiss import summary" onClick={() => setImportNotice(null)}>×</button></div>}
    </div>
  )
}
