import { useEffect } from 'react'
import { CircleMarker, LayerGroup, Polyline, Popup, Tooltip, useMap } from 'react-leaflet'

function advertisedTime(value) {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not supplied'
}

export default function LocalOverlayMap({ layers, zoomRequest }) {
  const map = useMap()
  useEffect(() => {
    if (!zoomRequest?.nodes.length) return
    map.fitBounds(zoomRequest.nodes.map(n => [n.lat, n.lng]), { padding: [36, 36], maxZoom: 14, animate: false })
  }, [map, zoomRequest])
  return layers.map(layer => <LayerGroup key={layer.id}>
    {layer.nodes.map(node => <LayerGroup key={node.id}>
      {node.positionDifference > 100 && <Polyline positions={[[node.lat, node.lng], [node.publicMatch.lat, node.publicMatch.lng]]} pathOptions={{ color: layer.color, weight: 2, dashArray: '5 5' }} />}
      <CircleMarker center={[node.lat, node.lng]} radius={node.comparison === 'both' ? 12 : 7} pathOptions={{ color: layer.color, weight: 3, fillColor: layer.color, fillOpacity: node.comparison === 'both' ? 0.15 : 0.9 }}>
        <Tooltip>{node.name} · {layer.name}</Tooltip>
        <Popup><div className="overlay-popup">
          <strong>{node.name}</strong><div>{node.roleRaw || 'Unknown type'} · {node.network}</div>
          <div>Local layer: {layer.name}</div><div>{node.lat.toFixed(6)}, {node.lng.toFixed(6)}</div>
          <p>{node.comparison === 'both' ? 'Both sources' : node.comparison === 'local-only' ? 'Local only in loaded public data' : 'No supported identity for comparison'}</p>
          {node.publicMatch && <div>Public name: {node.publicMatch.name}<br />Position difference: {Math.round(node.positionDifference).toLocaleString()} m</div>}
          <div>Snapshot: {layer.capturedAt ? new Date(layer.capturedAt).toLocaleString() : 'not supplied'}</div>
          <div>Advertised time: {advertisedTime(node.advertisedAt)}</div>
          <p className="overlay-popup-note">Stored contact, not proof of current reachability. Advertised clocks may be inaccurate.</p>
        </div></Popup>
      </CircleMarker>
    </LayerGroup>)}
  </LayerGroup>)
}
