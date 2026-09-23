import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Toolbar from './components/Toolbar'
import LiveDataPanel from './components/LiveDataPanel'
import RegionPicker from './components/RegionPicker'
import AddNodeModal from './components/AddNodeModal'
import {
  loadNodes,
  persistNodes,
  createNode,
  resetToSample,
  downloadNodesAsFile,
  readNodesFromFile,
} from './utils/nodeStore'
import { useLiveNodes } from './hooks/useLiveNodes'
import { fetchMeshcoreNodes } from './api/meshcoreLive'
import { fetchMeshtasticNodes } from './api/meshtasticLive'
import './App.css'

export default function App() {
  const [nodes, setNodes] = useState(() => loadNodes())
  const [pickMode, setPickMode] = useState(false)
  const [pendingLatLng, setPendingLatLng] = useState(null)
  const [importError, setImportError] = useState('')
  const [meshcoreLiveOn, setMeshcoreLiveOn] = useState(false)
  const [meshtasticLiveOn, setMeshtasticLiveOn] = useState(false)
  const [snapshotNodes, setSnapshotNodes] = useState([])

  const meshcoreLive = useLiveNodes(fetchMeshcoreNodes, { enabled: meshcoreLiveOn })
  const meshtasticLive = useLiveNodes(fetchMeshtasticNodes, { enabled: meshtasticLiveOn })

  function handleRegionLoaded(regionNodes) {
    setSnapshotNodes(regionNodes)
  }

  const allNodes = useMemo(
    () => [...nodes, ...meshcoreLive.nodes, ...meshtasticLive.nodes, ...snapshotNodes],
    [nodes, meshcoreLive.nodes, meshtasticLive.nodes, snapshotNodes],
  )

  useEffect(() => {
    persistNodes(nodes)
  }, [nodes])

  function handlePick(latlng) {
    setPendingLatLng(latlng)
    setPickMode(false)
  }

  function handleSaveNode(fields) {
    setNodes((prev) => [...prev, createNode(fields)])
    setPendingLatLng(null)
  }

  function handleDeleteNode(id) {
    setNodes((prev) => prev.filter((n) => n.id !== id))
  }

  function handleImport(file) {
    setImportError('')
    readNodesFromFile(file)
      .then((imported) => setNodes(imported))
      .catch((err) => setImportError(err.message))
  }

  function handleReset() {
    if (window.confirm('Replace current nodes with the sample data set?')) {
      setNodes(resetToSample())
    }
  }

  return (
    <div className="app">
      <div className="top-stack">
        <Toolbar
          pickMode={pickMode}
          onStartPick={() => setPickMode(true)}
          onCancelPick={() => setPickMode(false)}
          onImport={handleImport}
          onExport={() => downloadNodesAsFile(nodes)}
          onReset={handleReset}
          nodeCount={nodes.length}
        />
        <RegionPicker onNodesLoaded={handleRegionLoaded} />
        <LiveDataPanel
          meshcoreLive={meshcoreLive}
          meshtasticLive={meshtasticLive}
          meshcoreOn={meshcoreLiveOn}
          meshtasticOn={meshtasticLiveOn}
          onToggleMeshcore={setMeshcoreLiveOn}
          onToggleMeshtastic={setMeshtasticLiveOn}
        />
      </div>

      {importError && (
        <div className="import-error" onClick={() => setImportError('')}>
          Import failed: {importError} (tap to dismiss)
        </div>
      )}

      <MapView
        nodes={allNodes}
        pickMode={pickMode}
        onPick={handlePick}
        pendingLatLng={pendingLatLng}
        onDeleteNode={handleDeleteNode}
      />

      {pendingLatLng && (
        <AddNodeModal
          latlng={pendingLatLng}
          onCancel={() => setPendingLatLng(null)}
          onSave={handleSaveNode}
        />
      )}
    </div>
  )
}
