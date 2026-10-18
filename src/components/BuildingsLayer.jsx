import { useEffect, useRef, useState } from 'react'
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import { lonToTileX, latToTileY, tileKey } from '../../scripts/lib/tileGrid.mjs'
import { buildingStyle } from '../utils/buildingHeight'

// Buildings only render at a reasonably close zoom — below this they'd just
// be noise (and a world-wide viewport would mean fetching an unbounded
// number of tiles). Separate from BUILDING_TILE_ZOOM (14, the data's own
// grid): at 15 a typical screenful needs only ~1-4 z14 tiles.
const MIN_ZOOM = 15
// Safety cap on how many new tiles one viewport update will kick off a
// fetch for — a very large or fast pan shouldn't fire off dozens at once.
const MAX_FETCHES_PER_UPDATE = 24

const ATTRIBUTION = 'Buildings: &copy; OpenStreetMap contributors, Microsoft, Overture Maps Foundation'

export default function BuildingsLayer({ visible }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  const [tiles, setTiles] = useState({}) // "x_y" -> FeatureCollection
  const requestedKeys = useRef(new Set())
  const attributionAdded = useRef(false)

  function fetchVisibleTiles() {
    if (!visible || map.getZoom() < MIN_ZOOM) return
    const bounds = map.getBounds()
    const xMin = lonToTileX(bounds.getWest())
    const xMax = lonToTileX(bounds.getEast())
    const yMin = latToTileY(bounds.getNorth())
    const yMax = latToTileY(bounds.getSouth())

    let fetchCount = 0
    for (let x = xMin; x <= xMax && fetchCount < MAX_FETCHES_PER_UPDATE; x++) {
      for (let y = yMin; y <= yMax && fetchCount < MAX_FETCHES_PER_UPDATE; y++) {
        const key = tileKey(x, y)
        if (requestedKeys.current.has(key)) continue
        requestedKeys.current.add(key) // mark immediately so an in-flight tile isn't requested twice
        fetchCount++
        fetch(`${import.meta.env.BASE_URL}buildings/${x}_${y}.json`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) setTiles((prev) => ({ ...prev, [key]: data }))
          })
          .catch(() => {}) // a missing/failed tile just means no buildings shown there
      }
    }
  }

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom())
      fetchVisibleTiles()
    },
    moveend() {
      fetchVisibleTiles()
    },
  })

  useEffect(() => {
    if (visible) fetchVisibleTiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // Leaflet's attribution control doesn't know about plain GeoJSON overlays
  // the way it auto-credits TileLayers, so it's added/removed by hand here,
  // matching the data's real ODbL attribution requirement.
  useEffect(() => {
    const control = map.attributionControl
    if (!control) return
    if (visible && !attributionAdded.current) {
      control.addAttribution(ATTRIBUTION)
      attributionAdded.current = true
    } else if (!visible && attributionAdded.current) {
      control.removeAttribution(ATTRIBUTION)
      attributionAdded.current = false
    }
    return () => {
      if (attributionAdded.current) {
        control.removeAttribution(ATTRIBUTION)
        attributionAdded.current = false
      }
    }
  }, [visible, map])

  if (!visible || zoom < MIN_ZOOM) return null

  return (
    <>
      {/* interactive=false: a GeoJSON polygon captures its own clicks by
          default, same as a Marker — without this, clicking anywhere a
          building happens to render would silently swallow a Measure-tool
          click instead of it reaching the map. No popups/hover are planned
          for buildings in this layer, so there's nothing lost by it. */}
      {Object.entries(tiles).map(([key, data]) => (
        <GeoJSON key={key} data={data} style={(feature) => buildingStyle(feature.properties)} interactive={false} />
      ))}
    </>
  )
}
