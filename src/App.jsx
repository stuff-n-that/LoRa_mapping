import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Toolbar from './components/Toolbar'
import LiveDataPanel from './components/LiveDataPanel'
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
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState(null)

  const meshcoreLive = useLiveNodes(fetchMeshcoreNodes, { enabled: meshcoreLiveOn })
  const meshtasticLive = useLiveNodes(fetchMeshtasticNodes, { enabled: meshtasticLiveOn })

  // Optional static snapshot embedded at build time by the "Refresh live node
  // snapshot" step in .github/workflows/deploy.yml (node scripts/pull-live-nodes.mjs
  // public/live-nodes-snapshot.json). Loaded once — it only changes on the next
  // deploy — and simply absent (404, silently ignored) if that step never ran,
  // e.g. in local dev.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}live-nodes-snapshot.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.nodes) return
        setSnapshotNodes(data.nodes.map((n) => ({ ...n, id: `snapshot-${n.id}`, source: 'snapshot' })))
        setSnapshotGeneratedAt(data.generatedAt || null)
      })
      .catch(() => {})
  }, [])

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
          snapshotCount={snapshotNodes.length}
          snapshotGeneratedAt={snapshotGeneratedAt}
        />
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
