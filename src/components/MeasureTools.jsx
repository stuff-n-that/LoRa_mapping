import { useEffect, useState } from 'react'
import { Circle, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { haversineDistanceKm } from '../utils/checkPlausibility'
import { formatDistance } from '../utils/format'
import { measureCenterIcon, measureHandleIcon } from '../utils/icons'

const MEASURE_PATH_OPTIONS = { color: '#ffcc00', weight: 3 }
const PREVIEW_PATH_OPTIONS = { color: '#ffcc00', weight: 2, dashArray: '4 6', opacity: 0.6, fillOpacity: 0.05 }

// Clicking a handle marker shouldn't also register as a map click (which
// would start a brand-new measurement under it).
function stopClickPropagation(e) {
  L.DomEvent.stopPropagation(e.originalEvent)
}

// Rendered inside <MapContainer> so it can use the map's click/mousemove
// events directly. `mode` is controlled by the Measure panel; this component
// owns the in-progress/placed geometry for whichever tool is active and
// reports the live result text back up via onChange.
export default function MeasureTools({ mode, onChange }) {
  const map = useMap()
  const [stage, setStage] = useState('idle') // 'idle' | 'drawing' | 'placed'
  const [line, setLine] = useState({ a: null, b: null })
  const [circle, setCircle] = useState({ center: null, edge: null })
  const [cursor, setCursor] = useState(null)

  // Switching tools (including turning measuring off) clears whatever was
  // drawn — only one measurement is ever shown at a time.
  useEffect(() => {
    setStage('idle')
    setLine({ a: null, b: null })
    setCircle({ center: null, edge: null })
    setCursor(null)
  }, [mode])

  useEffect(() => {
    const container = map.getContainer()
    container.style.cursor = mode === 'none' ? '' : 'crosshair'
    return () => {
      container.style.cursor = ''
    }
  }, [map, mode])

  // Reports the live result text up to the Measure panel. Kept in its own
  // effect (reacting to this component's own state) rather than called
  // inline alongside setLine/setCircle/etc. in the handlers below, so
  // updating this component's state and the parent's state never happen
  // within the same synchronous call — doing that from a Leaflet drag
  // handler trips React's "update while rendering a different component"
  // check.
  useEffect(() => {
    if (mode === 'line' && line.a) {
      const b = line.b || (stage === 'drawing' ? cursor : null)
      onChange({ stage, text: b ? formatDistance(haversineDistanceKm(line.a[0], line.a[1], b[0], b[1])) : null })
    } else if (mode === 'circle' && circle.center) {
      const edge = circle.edge || (stage === 'drawing' ? cursor : null)
      onChange({
        stage,
        text: edge ? formatDistance(haversineDistanceKm(circle.center[0], circle.center[1], edge[0], edge[1])) : null,
      })
    } else {
      onChange({ stage, text: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, stage, line, circle, cursor])

  useMapEvents({
    click(e) {
      if (mode === 'none') return
      const point = [e.latlng.lat, e.latlng.lng]

      if (mode === 'line') {
        if (stage !== 'drawing') {
          setStage('drawing')
          setLine({ a: point, b: null })
        } else {
          setStage('placed')
          setLine((prev) => ({ ...prev, b: point }))
        }
      } else if (mode === 'circle') {
        if (stage !== 'drawing') {
          setStage('drawing')
          setCircle({ center: point, edge: null })
        } else {
          setStage('placed')
          setCircle((prev) => ({ ...prev, edge: point }))
        }
      }
      setCursor(null)
    },
    mousemove(e) {
      if (mode === 'none' || stage !== 'drawing') return
      setCursor([e.latlng.lat, e.latlng.lng])
    },
  })

  function handleDragLineA(e) {
    const ll = e.target.getLatLng()
    setLine((prev) => ({ ...prev, a: [ll.lat, ll.lng] }))
  }

  function handleDragLineB(e) {
    const ll = e.target.getLatLng()
    setLine((prev) => ({ ...prev, b: [ll.lat, ll.lng] }))
  }

  function handleDragCircleEdge(e) {
    const ll = e.target.getLatLng()
    setCircle((prev) => ({ ...prev, edge: [ll.lat, ll.lng] }))
  }

  if (mode === 'line') {
    return (
      <>
        {line.a && line.b && <Polyline positions={[line.a, line.b]} pathOptions={MEASURE_PATH_OPTIONS} />}
        {line.a && !line.b && cursor && <Polyline positions={[line.a, cursor]} pathOptions={PREVIEW_PATH_OPTIONS} />}
        {line.a && (
          <Marker
            position={line.a}
            icon={measureHandleIcon()}
            draggable={!!line.b}
            eventHandlers={{ click: stopClickPropagation, drag: handleDragLineA }}
          />
        )}
        {line.b && (
          <Marker position={line.b} icon={measureHandleIcon()} draggable eventHandlers={{ click: stopClickPropagation, drag: handleDragLineB }} />
        )}
      </>
    )
  }

  if (mode === 'circle') {
    const radiusKm = circle.center && circle.edge ? haversineDistanceKm(circle.center[0], circle.center[1], circle.edge[0], circle.edge[1]) : null
    const previewRadiusKm =
      circle.center && !circle.edge && cursor ? haversineDistanceKm(circle.center[0], circle.center[1], cursor[0], cursor[1]) : null

    return (
      <>
        {circle.center && circle.edge && (
          <Circle center={circle.center} radius={radiusKm * 1000} pathOptions={{ ...MEASURE_PATH_OPTIONS, fillOpacity: 0.08 }} />
        )}
        {circle.center && !circle.edge && cursor && <Circle center={circle.center} radius={previewRadiusKm * 1000} pathOptions={PREVIEW_PATH_OPTIONS} />}
        {circle.center && <Marker position={circle.center} icon={measureCenterIcon()} interactive={false} />}
        {circle.edge && (
          <Marker
            position={circle.edge}
            icon={measureHandleIcon()}
            draggable
            eventHandlers={{ click: stopClickPropagation, drag: handleDragCircleEdge }}
          />
        )}
      </>
    )
  }

  return null
}
