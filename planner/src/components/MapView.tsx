import { useEffect, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS, styleFor, type BasemapId } from '../basemaps'
import { TERRAIN_ATTRIBUTION } from '../engine/terrain'
import type { LatLng } from '../engine/geo'
import type { Overlay } from '../hooks'
import type { ExistingNode } from '../nodes'

export interface MapViewTarget {
  /** Change to trigger a move. */
  id: number
  bounds?: [[number, number], [number, number]]
  center?: LatLng
  zoom?: number
}

interface Props {
  basemap: BasemapId
  onBasemapUnavailable: () => void
  nodes: ExistingNode[]
  planned: LatLng | null
  onPlace: (ll: LatLng) => void
  onMovePlanned: (ll: LatLng) => void
  overlay: Overlay | null
  overlayOpacity: number
  /** Text for the "what is the signal here" popup, or null for nothing to show. */
  inspect: (ll: LatLng) => string | null
  onPlanHere: (ll: LatLng) => void
  target: MapViewTarget | null
  /** Changes when the surrounding layout changes size. */
  layoutKey: string
}

const COLOR = { meshcore: '#3aa0ff', meshtastic: '#5fd88f' }
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function toGeoJson(nodes: ExistingNode[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: nodes.map((n) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
      properties: { id: n.id, name: n.name, network: n.network, role: n.roleRaw ?? '', roleCategory: n.roleCategory, lastSeen: n.lastSeen },
    })),
  }
}

function text(tag: string, content: string, style?: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement(tag)
  e.textContent = content // never innerHTML: node names come from public networks
  if (style) Object.assign(e.style, style)
  return e
}

export default function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const styleReady = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const firstBasemap = useRef(true)

  // ---- (re)create sources and layers after every style load ------------------------
  function syncLayers() {
    const map = mapRef.current
    // Not isStyleLoaded(): that is false while the new style's tiles are still loading,
    // which is exactly when the layers need adding.
    if (!map || !styleReady.current) return
    const { overlay, overlayOpacity, nodes } = latest.current

    if (overlay) {
      const existing = map.getSource('coverage') as ImageSource | undefined
      if (existing) existing.updateImage({ url: overlay.url, coordinates: overlay.corners })
      else {
        map.addSource('coverage', { type: 'image', url: overlay.url, coordinates: overlay.corners })
        // keep place names above the heat map where the style has labels
        const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
        map.addLayer({ id: 'coverage', type: 'raster', source: 'coverage', paint: { 'raster-opacity': overlayOpacity, 'raster-fade-duration': 0 } }, firstSymbol)
      }
    } else if (map.getLayer('coverage')) {
      map.removeLayer('coverage')
      map.removeSource('coverage')
    }

    if (!map.getSource('nodes')) {
      map.addSource('nodes', {
        type: 'geojson',
        data: toGeoJson(nodes),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 11,
        clusterProperties: {
          mc: ['+', ['case', ['==', ['get', 'network'], 'meshcore'], 1, 0]],
          mt: ['+', ['case', ['==', ['get', 'network'], 'meshtastic'], 1, 0]],
        },
      })
      map.addLayer({
        id: 'node-clusters',
        type: 'circle',
        source: 'nodes',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['case', ['>', ['get', 'mc'], ['get', 'mt']], COLOR.meshcore, COLOR.meshtastic],
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 13, 25, 17, 200, 22, 1000, 28],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'node-cluster-count',
        type: 'symbol',
        source: 'nodes',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
        paint: { 'text-color': '#0b0b0d' },
      })
      map.addLayer({
        id: 'node-points',
        type: 'circle',
        source: 'nodes',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'network'], 'meshcore', COLOR.meshcore, COLOR.meshtastic],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 6, 16, 8],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      })
    }
  }

  // ---- create the map once -----------------------------------------------------------
  useEffect(() => {
    const p = latest.current
    const map = new maplibregl.Map({
      container: container.current as HTMLDivElement,
      style: styleFor(p.basemap),
      center: p.planned ? [p.planned.lng, p.planned.lat] : [10, 30],
      zoom: p.planned ? 11 : 2.2,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    // Handle for browser tests; not present in production builds.
    if (import.meta.env.DEV) (window as unknown as { __plannerMap?: MlMap }).__plannerMap = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left')
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true, // collapsed behind the (i) button; still one tap away
        customAttribution: [TERRAIN_ATTRIBUTION, 'Nodes: community MeshCore &amp; Meshtastic maps'],
      }),
      'bottom-right',
    )

    map.on('style.load', () => {
      styleReady.current = true
      syncLayers()
    })
    map.on('error', () => {
      // A street style that never loads (blocked or offline) falls back to shaded relief.
      if (!styleReady.current && latest.current.basemap === 'streets') latest.current.onBasemapUnavailable()
    })

    const pointer = () => (map.getCanvas().style.cursor = 'pointer')
    const normal = () => (map.getCanvas().style.cursor = '')
    for (const id of ['node-clusters', 'node-points']) {
      map.on('mouseenter', id, pointer)
      map.on('mouseleave', id, normal)
    }

    map.on('click', 'node-clusters', (e) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const src = map.getSource('nodes') as GeoJSONSource
      const clusterId = Number(f.properties?.cluster_id)
      src.getClusterExpansionZoom(clusterId).then((zoom) => map.easeTo({ center: f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : undefined, zoom: zoom + 0.5 }))
    })

    map.on('click', 'node-points', (e) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const [lng, lat] = f.geometry.coordinates as [number, number]
      const pr = f.properties ?? {}
      const box = document.createElement('div')
      box.style.minWidth = '180px'
      box.appendChild(text('strong', String(pr.name || 'Unnamed node')))
      box.appendChild(text('div', pr.network === 'meshcore' ? 'MeshCore' : 'Meshtastic', { color: pr.network === 'meshcore' ? COLOR.meshcore : '#2c9b62', fontWeight: '600', fontSize: '12px' }))
      if (pr.role) box.appendChild(text('div', `Role: ${pr.role}`, { fontSize: '12px' }))
      if (pr.lastSeen) box.appendChild(text('div', `Last seen: ${pr.lastSeen}`, { fontSize: '12px' }))
      box.appendChild(text('div', `${lat.toFixed(5)}, ${lng.toFixed(5)}`, { fontSize: '11px', opacity: '0.65', marginTop: '2px' }))
      const btn = text('button', 'Plan a node here', {
        marginTop: '8px', font: 'inherit', fontSize: '12px', padding: '4px 8px', cursor: 'pointer', borderRadius: '6px', border: '1px solid #999', background: 'transparent', color: 'inherit',
      })
      btn.addEventListener('click', () => {
        latest.current.onPlanHere({ lat, lng })
        popup.remove()
      })
      box.appendChild(btn)
      const popup = new maplibregl.Popup({ offset: 10, maxWidth: '260px' }).setLngLat([lng, lat]).setDOMContent(box).addTo(map)
    })

    map.on('click', (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['node-clusters', 'node-points'].filter((l) => map.getLayer(l)) }).length) return
      const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      if (!latest.current.planned) {
        latest.current.onPlace(ll)
        return
      }
      const message = latest.current.inspect(ll)
      if (message) new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(e.lngLat).setText(message).addTo(map)
    })

    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
      styleReady.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- basemap ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (firstBasemap.current) {
      firstBasemap.current = false
      return
    }
    styleReady.current = false
    map.setStyle(styleFor(props.basemap))
  }, [props.basemap])

  // ---- existing nodes ----------------------------------------------------------------------
  useEffect(() => {
    if (!styleReady.current) return // syncLayers() picks the latest nodes up once the style loads
    const src = mapRef.current?.getSource('nodes') as GeoJSONSource | undefined
    src?.setData(props.nodes.length ? toGeoJson(props.nodes) : EMPTY)
  }, [props.nodes])

  // ---- coverage overlay -----------------------------------------------------------------------
  useEffect(() => {
    syncLayers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.overlay])

  useEffect(() => {
    const map = mapRef.current
    if (styleReady.current && map?.getLayer('coverage')) map.setPaintProperty('coverage', 'raster-opacity', props.overlayOpacity)
  }, [props.overlayOpacity])

  // ---- the planned node ----------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!props.planned) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (!markerRef.current) {
      const el = document.createElement('div')
      el.className = 'planned-marker'
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', 'Planned node (drag to move)')
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([props.planned.lng, props.planned.lat]).addTo(map)
      marker.on('dragend', () => {
        const ll = marker.getLngLat()
        latest.current.onMovePlanned({ lat: ll.lat, lng: ll.lng })
      })
      markerRef.current = marker
    } else {
      markerRef.current.setLngLat([props.planned.lng, props.planned.lat])
    }
  }, [props.planned])

  // ---- moving the view ------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    const t = props.target
    if (!map || !t) return
    if (t.bounds) map.fitBounds(t.bounds, { padding: 70, maxZoom: 10, duration: 700 })
    else if (t.center) map.easeTo({ center: [t.center.lng, t.center.lat], zoom: t.zoom ?? 11, duration: 700 })
  }, [props.target])

  useEffect(() => {
    mapRef.current?.resize()
  }, [props.layoutKey])

  return (
    <div className="map-wrap">
      <div ref={container} className="map" aria-label={`Map (${BASEMAPS.find((b) => b.id === props.basemap)?.label})`} />
    </div>
  )
}
