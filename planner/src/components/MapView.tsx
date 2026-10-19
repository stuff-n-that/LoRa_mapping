import { useEffect, useRef } from 'react'
import type { FeatureCollection, MultiLineString } from 'geojson'
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS, registerTopoProtocols, styleFor, type BasemapId } from '../basemaps'
import { TERRAIN_ATTRIBUTION } from '../engine/terrain'
import type { LatLng } from '../engine/geo'
import type { Overlay } from '../hooks'
import type { Verdict } from '../engine/link'
import type { ContourProps } from '../contours'
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
  /** The planned nodes, drawn as numbered pins. */
  planned: PlannedPin[]
  selectedId: string | null
  onSelectNode: (id: string) => void
  onMoveNode: (id: string, ll: LatLng) => void
  /** True while the next click should add a node (it always does when there are none yet). */
  placing: boolean
  onPlace: (ll: LatLng) => void
  overlay: Overlay | null
  overlayOpacity: number
  /** Lines for the "what is the signal here" popup, or null for nothing to show. */
  inspect: (ll: LatLng) => string[] | null
  onPlanHere: (ll: LatLng) => void
  target: MapViewTarget | null
  /** Changes when the surrounding layout changes size. */
  layoutKey: string
  /** The link being analysed: a line between its ends, coloured by how good it looks. */
  link: LinkOnMap | null
  /** True while the next click should place the far end of a link. */
  pickingTarget: boolean
  onPickTarget: (ll: LatLng) => void
  onMoveTarget: (ll: LatLng) => void
  /** Lines where the signal crosses a margin, or null for none. */
  signalLines: FeatureCollection<MultiLineString, ContourProps> | null
  /** Show the signal under the pointer as it moves. */
  hover: boolean
}

export interface LinkOnMap {
  a: LatLng
  b: LatLng
  /** The far end is a draggable map point rather than a planned node. */
  bIsTarget: boolean
  verdict: Verdict | null
  /** Where the chart cursor is, and where the ground blocks the line of sight, if anywhere. */
  cursor: LatLng | null
  obstruction: LatLng | null
}

export interface PlannedPin {
  id: string
  position: LatLng
  /** The number drawn on the pin. */
  label: number
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
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const signalPopup = useRef<maplibregl.Popup | null>(null)
  const targetMarker = useRef<maplibregl.Marker | null>(null)
  const hoverEl = useRef<HTMLDivElement>(null)
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

  function syncExtras() {
    const map = mapRef.current
    if (!map || !styleReady.current) return
    const { link, signalLines } = latest.current

    const lines = signalLines ?? EMPTY
    const existingLines = map.getSource('signal-lines') as GeoJSONSource | undefined
    if (existingLines) existingLines.setData(lines)
    else {
      map.addSource('signal-lines', { type: 'geojson', data: lines })
      map.addLayer({
        id: 'signal-lines',
        type: 'line',
        source: 'signal-lines',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#101018', 'line-width': 1.4, 'line-opacity': 0.75 },
      })
      map.addLayer({
        id: 'signal-line-labels',
        type: 'symbol',
        source: 'signal-lines',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 320,
          'text-field': ['concat', ['to-string', ['get', 'level']], ' dB'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
        },
        paint: { 'text-color': '#101018', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      })
    }

    const features: FeatureCollection['features'] = []
    if (link) {
      features.push({ type: 'Feature', properties: { kind: 'line', verdict: link.verdict ?? 'none' }, geometry: { type: 'LineString', coordinates: [[link.a.lng, link.a.lat], [link.b.lng, link.b.lat]] } })
      if (link.obstruction) features.push({ type: 'Feature', properties: { kind: 'block' }, geometry: { type: 'Point', coordinates: [link.obstruction.lng, link.obstruction.lat] } })
      if (link.cursor) features.push({ type: 'Feature', properties: { kind: 'cursor' }, geometry: { type: 'Point', coordinates: [link.cursor.lng, link.cursor.lat] } })
    }
    const data: FeatureCollection = { type: 'FeatureCollection', features }
    const existingLink = map.getSource('link') as GeoJSONSource | undefined
    if (existingLink) existingLink.setData(data)
    else {
      map.addSource('link', { type: 'geojson', data })
      map.addLayer({ id: 'link-casing', type: 'line', source: 'link', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round' } })
      map.addLayer({
        id: 'link-line',
        type: 'line',
        source: 'link',
        filter: ['==', ['get', 'kind'], 'line'],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-width': 4,
          'line-color': ['match', ['get', 'verdict'], 'good', '#1f9d55', 'marginal', '#e6a100', 'poor', '#d93a17', '#6b6b78'],
        },
      })
      map.addLayer({ id: 'link-block', type: 'circle', source: 'link', filter: ['==', ['get', 'kind'], 'block'], paint: { 'circle-radius': 7, 'circle-color': '#d93a17', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } })
      map.addLayer({ id: 'link-cursor', type: 'circle', source: 'link', filter: ['==', ['get', 'kind'], 'cursor'], paint: { 'circle-radius': 8, 'circle-color': 'rgba(255,255,255,0.25)', 'circle-stroke-width': 3, 'circle-stroke-color': '#101018' } })
    }
  }

  // ---- create the map once -----------------------------------------------------------
  useEffect(() => {
    const p = latest.current
    registerTopoProtocols() // before any style that uses them is requested
    const map = new maplibregl.Map({
      container: container.current as HTMLDivElement,
      style: styleFor(p.basemap),
      center: p.planned[0] ? [p.planned[0].position.lng, p.planned[0].position.lat] : [10, 30],
      zoom: p.planned[0] ? 11 : 2.2,
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
      syncExtras()
    })
    map.on('error', () => {
      // A street style that never loads (blocked or offline) falls back to the topographic map.
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
      if (latest.current.pickingTarget) {
        latest.current.onPickTarget(ll)
        return
      }
      if (latest.current.planned.length === 0 || latest.current.placing) {
        latest.current.onPlace(ll)
        return
      }
      signalPopup.current?.remove() // only ever one readout on screen
      signalPopup.current = null
      const lines = latest.current.inspect(ll)
      if (!lines || lines.length === 0) return
      const message = lines.join('. ')
      // Clicking the readout itself dismisses it; clicking elsewhere on the map reads that spot instead.
      const box = document.createElement('div')
      box.className = 'signal-readout'
      box.setAttribute('role', 'button')
      box.tabIndex = 0
      box.setAttribute('aria-label', `${message}. Activate to dismiss.`)
      lines.forEach((line, i) => box.appendChild(text('div', line, i === 0 ? undefined : { fontSize: '12px', opacity: '0.8' })))
      box.appendChild(text('div', 'Click to dismiss', { fontSize: '11px', opacity: '0.6', marginTop: '2px' }))
      const popup: maplibregl.Popup = new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(e.lngLat).setDOMContent(box).addTo(map)
      const dismiss = () => popup.remove()
      box.addEventListener('click', dismiss)
      box.addEventListener('keydown', (k) => {
        if (k.key === 'Enter' || k.key === ' ' || k.key === 'Escape') {
          k.preventDefault()
          dismiss()
        }
      })
      popup.on('close', () => {
        if (signalPopup.current === popup) signalPopup.current = null
      })
      signalPopup.current = popup
    })

    // Live readout under the pointer, if switched on. One frame at a time, so a fast mouse stays cheap.
    let frame = 0
    const hideHover = () => {
      cancelAnimationFrame(frame)
      if (hoverEl.current) hoverEl.current.hidden = true
    }
    map.on('mousemove', (e) => {
      const el = hoverEl.current
      const p = latest.current
      if (!el) return
      if (!p.hover || p.placing || p.pickingTarget) {
        el.hidden = true
        return
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const first = p.inspect({ lat: e.lngLat.lat, lng: e.lngLat.lng })?.[0]
        if (!first || first.startsWith('Outside')) {
          el.hidden = true
          return
        }
        el.textContent = first
        el.hidden = false
        el.style.transform = `translate(${Math.round(e.point.x + 14)}px, ${Math.round(e.point.y + 14)}px)`
      })
    })
    map.on('mouseout', hideHover)
    map.on('movestart', hideHover)

    return () => {
      cancelAnimationFrame(frame)
      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()
      targetMarker.current?.remove()
      targetMarker.current = null
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

  // ---- the planned nodes: one numbered, draggable pin each -----------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const pins = markersRef.current
    const wanted = new Set(props.planned.map((p) => p.id))
    pins.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.remove()
        pins.delete(id)
      }
    })
    for (const pin of props.planned) {
      let marker = pins.get(pin.id)
      if (!marker) {
        const el = document.createElement('div')
        el.className = 'planned-marker'
        el.setAttribute('role', 'button')
        el.addEventListener('click', (ev) => {
          ev.stopPropagation() // selecting a pin must not also read the signal under it
          latest.current.onSelectNode(pin.id)
        })
        const created = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([pin.position.lng, pin.position.lat]).addTo(map)
        created.on('dragstart', () => latest.current.onSelectNode(pin.id))
        created.on('dragend', () => {
          const ll = created.getLngLat()
          latest.current.onMoveNode(pin.id, { lat: ll.lat, lng: ll.lng })
        })
        pins.set(pin.id, created)
        marker = created
      } else {
        marker.setLngLat([pin.position.lng, pin.position.lat])
      }
      const el = marker.getElement()
      el.textContent = String(pin.label)
      el.classList.toggle('selected', pin.id === props.selectedId)
      el.setAttribute('aria-label', `Node ${pin.label}${pin.id === props.selectedId ? ' (selected)' : ''}. Drag to move.`)
    }
  }, [props.planned, props.selectedId])

  // ---- the link line, its markers, and the signal lines --------------------------------------
  useEffect(() => {
    syncExtras()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.link, props.signalLines])

  // the far end of a link that is a point on the map: a draggable flag
  const targetAt = props.link?.bIsTarget ? props.link.b : null
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!targetAt) {
      targetMarker.current?.remove()
      targetMarker.current = null
      return
    }
    if (!targetMarker.current) {
      const el = document.createElement('div')
      el.className = 'target-marker'
      el.textContent = 'B'
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', 'Far end of the link. Drag to move.')
      el.addEventListener('click', (ev) => ev.stopPropagation())
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([targetAt.lng, targetAt.lat]).addTo(map)
      m.on('dragend', () => {
        const ll = m.getLngLat()
        latest.current.onMoveTarget({ lat: ll.lat, lng: ll.lng })
      })
      targetMarker.current = m
    } else {
      targetMarker.current.setLngLat([targetAt.lng, targetAt.lat])
    }
  }, [targetAt?.lat, targetAt?.lng, !!targetAt])

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
      <div ref={container} className={`map${props.placing || props.pickingTarget ? ' placing' : ''}`} aria-label={`Map (${BASEMAPS.find((b) => b.id === props.basemap)?.label})`} />
      <div ref={hoverEl} className="hover-readout" hidden aria-hidden="true" />
    </div>
  )
}
