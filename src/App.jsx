import { useEffect, useState } from 'react'
import MapView from './components/MapView'
import Toolbar from './components/Toolbar'
import AddNodeModal from './components/AddNodeModal'
import {
  loadNodes,
  persistNodes,
  createNode,
  resetToSample,
  downloadNodesAsFile,
  readNodesFromFile,
} from './utils/nodeStore'
import './App.css'

export default function App() {
  const [nodes, setNodes] = useState(() => loadNodes())
  const [pickMode, setPickMode] = useState(false)
  const [pendingLatLng, setPendingLatLng] = useState(null)
  const [importError, setImportError] = useState('')

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
      <Toolbar
        pickMode={pickMode}
        onStartPick={() => setPickMode(true)}
        onCancelPick={() => setPickMode(false)}
        onImport={handleImport}
        onExport={() => downloadNodesAsFile(nodes)}
        onReset={handleReset}
        nodeCount={nodes.length}
      />

      {importError && (
        <div className="import-error" onClick={() => setImportError('')}>
          Import failed: {importError} (tap to dismiss)
        </div>
      )}

      <MapView
        nodes={nodes}
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
