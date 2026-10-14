import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Toolbar from './components/Toolbar'
import MapLayersPanel from './components/MapLayersPanel'
import RegionPicker from './components/RegionPicker'
import NodeTypeFilter from './components/NodeTypeFilter'
import MeasurePanel from './components/MeasurePanel'
import { ROLE_CATEGORIES } from './utils/nodeRoles'
import { loadNodes, persistNodes } from './utils/nodeStore'
import './App.css'

export default function App() {
  const [nodes, setNodes] = useState(() => loadNodes())
  const [snapshotNodes, setSnapshotNodes] = useState([])
  const [selectedRegionCount, setSelectedRegionCount] = useState(0)
  const [enabledRoleCategories, setEnabledRoleCategories] = useState(
    () => new Set(ROLE_CATEGORIES.map((c) => c.key)),
  )
  const [baseLayer, setBaseLayer] = useState('streets')
  const [showMeshcore, setShowMeshcore] = useState(true)
  const [showMeshtastic, setShowMeshtastic] = useState(true)
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
          nodeCount={visibleNodes.length}
          selectedRegionCount={selectedRegionCount}
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
          />
          <RegionPicker onNodesLoaded={handleRegionLoaded} onSelectionCountChange={setSelectedRegionCount} />
          <NodeTypeFilter enabledCategories={enabledRoleCategories} onChange={setEnabledRoleCategories} />
          <MeasurePanel mode={measureMode} onModeChange={setMeasureMode} stage={measureInfo.stage} resultText={measureInfo.text} />
        </div>
      </div>

      <MapView
        nodes={visibleNodes}
        onDeleteNode={handleDeleteNode}
        baseLayer={baseLayer}
        showMeshcore={showMeshcore}
        showMeshtastic={showMeshtastic}
        measureMode={measureMode}
        onMeasureChange={setMeasureInfo}
      />
    </div>
  )
}
