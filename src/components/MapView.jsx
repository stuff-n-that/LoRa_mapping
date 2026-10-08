import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { nodeIcon } from '../utils/icons'

// Base layer selection now lives in MapLayersPanel (styled to match the
// rest of the app) instead of Leaflet's own default-styled LayersControl —
// this is the tile source for whichever one is currently selected there.
const BASE_LAYERS = {
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
}

function NodePopup({ node, onDelete }) {
  return (
    <Popup>
      <div style={{ minWidth: 180 }}>
        <strong>{node.name}</strong>
        <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'capitalize' }}>{node.network}</div>
        {node.roleRaw && <div style={{ fontSize: 12 }}>Type: {node.roleRaw}</div>}
        {node.hardware && <div style={{ fontSize: 12 }}>Hardware: {node.hardware}</div>}
        {node.lastSeen && <div style={{ fontSize: 12 }}>Last seen: {node.lastSeen}</div>}
        {node.notes && <div style={{ fontSize: 12, marginTop: 4 }}>{node.notes}</div>}
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
          {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
        </div>
        {node.source !== 'manual' ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, fontStyle: 'italic' }}>
            {node.source === 'snapshot'
              ? 'Snapshot data — refreshed periodically via CI, not editable'
              : 'Live data — refreshes automatically, not editable'}
          </div>
        ) : (
          <button
            onClick={() => onDelete(node.id)}
            style={{
              marginTop: 8,
              fontSize: 12,
              color: '#c0392b',
              background: 'none',
              border: '1px solid #c0392b',
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            Delete node
          </button>
        )}
      </div>
    </Popup>
  )
}

export default function MapView({ nodes, onDeleteNode, baseLayer, showMeshcore, showMeshtastic }) {
  const meshcoreNodes = useMemo(() => nodes.filter((n) => n.network === 'meshcore'), [nodes])
  const meshtasticNodes = useMemo(() => nodes.filter((n) => n.network === 'meshtastic'), [nodes])
  const layer = BASE_LAYERS[baseLayer] || BASE_LAYERS.streets

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      worldCopyJump
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
    >
      <ZoomControl position="bottomright" />

      {/* key forces a clean remount on switch, rather than react-leaflet
          patching the url of a live tile layer mid-flight. */}
      <TileLayer key={baseLayer} attribution={layer.attribution} url={layer.url} />

      {showMeshcore && (
        <MarkerClusterGroup chunkedLoading maxClusterRadius={60} disableClusteringAtZoom={14}>
          {meshcoreNodes.map((node) => (
            <Marker key={node.id} position={[node.lat, node.lng]} icon={nodeIcon('meshcore', node.source)}>
              <NodePopup node={node} onDelete={onDeleteNode} />
            </Marker>
          ))}
        </MarkerClusterGroup>
      )}

      {showMeshtastic && (
        <MarkerClusterGroup chunkedLoading maxClusterRadius={60} disableClusteringAtZoom={14}>
          {meshtasticNodes.map((node) => (
            <Marker key={node.id} position={[node.lat, node.lng]} icon={nodeIcon('meshtastic', node.source)}>
              <NodePopup node={node} onDelete={onDeleteNode} />
            </Marker>
          ))}
        </MarkerClusterGroup>
      )}
    </MapContainer>
  )
}
