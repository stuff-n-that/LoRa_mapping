import maplibregl, { type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl'
import mlcontour from 'maplibre-contour'
import { TERRAIN_ATTRIBUTION, TERRARIUM_URL } from './engine/terrain'

type DemSource = InstanceType<typeof mlcontour.DemSource>

export type BasemapId = 'streets' | 'satellite' | 'topo'

export const BASEMAPS: { id: BasemapId; label: string }[] = [
  { id: 'streets', label: 'Streets' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'topo', label: 'Topo' },
]

/** Free vector tiles, no key. Used as-is, which keeps its own attribution. */
export const STREETS_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

// Fonts for the node-count labels on custom styles.
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

const satellite: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
    },
  },
  layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
}

// Topographic map drawn in the browser from the same terrain tiles the coverage engine
// uses: a gentle elevation tint, hillshade and contour lines. It needs no other service,
// so it also works when the street map cannot be reached.
//
// The contour source shares one cache of decoded terrain tiles with the tint and hillshade
// layers (maplibre-contour), so adding contours costs no extra downloads.
const DEM_MAX_ZOOM = 12
let demSource: DemSource | null = null
let protocolsRegistered = false

function getDemSource(): DemSource {
  demSource ??= new mlcontour.DemSource({ url: TERRARIUM_URL, encoding: 'terrarium', maxzoom: DEM_MAX_ZOOM, worker: true })
  return demSource
}

/** Register the contour/terrain protocols with MapLibre. Safe to call more than once. */
export function registerTopoProtocols(): void {
  if (protocolsRegistered) return
  getDemSource().setupMaplibre(maplibregl)
  protocolsRegistered = true
}

// Metres above sea level -> colour. Pale and low-contrast on purpose, so the coverage
// colours stay easy to read on top of it.
const ELEVATION_TINT: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['elevation'],
  -200, '#b4cddc',
  -1, '#b4cddc',
  1, '#dbe5cf',
  150, '#e4e8cf',
  400, '#ebe6cc',
  800, '#e6dcc3',
  1300, '#dccfb8',
  2000, '#d3c6b5',
  3000, '#d8d1ca',
  4500, '#ece9e6',
]

function topoStyle(): StyleSpecification {
  const dem = getDemSource()
  const contourTiles = dem.contourProtocolUrl({
    // zoom -> [minor, major] spacing in metres
    thresholds: { 8: [500, 2000], 9: [200, 1000], 10: [100, 500], 11: [50, 250], 12: [20, 100], 13: [10, 50] },
    contourLayer: 'contours',
    elevationKey: 'ele',
    levelKey: 'level',
    extent: 4096,
    buffer: 1,
    overzoom: 1,
  })
  const label = ['concat', ['to-string', ['get', 'ele']], ' m'] as ExpressionSpecification
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      dem: { type: 'raster-dem', tiles: [dem.sharedDemProtocolUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX_ZOOM, attribution: TERRAIN_ATTRIBUTION },
      contours: { type: 'vector', tiles: [contourTiles], minzoom: 8, maxzoom: 15 },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e9e6dc' } },
      { id: 'elevation-tint', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': ELEVATION_TINT } },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#4b4640',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#7a746a',
        },
      },
      {
        id: 'contours-minor',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['==', ['get', 'level'], 0],
        paint: { 'line-color': '#8c6d4c', 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 14, 0.8] },
      },
      {
        id: 'contours-major',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['>', ['get', 'level'], 0],
        paint: { 'line-color': '#7a5733', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1.4] },
      },
      {
        id: 'contour-labels',
        type: 'symbol',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['>', ['get', 'level'], 0],
        minzoom: 10,
        layout: { 'symbol-placement': 'line', 'text-field': label, 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-max-angle': 30 },
        paint: { 'text-color': '#5e4328', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.5 },
      },
    ],
  }
}

export function styleFor(id: BasemapId): StyleSpecification | string {
  if (id === 'streets') return STREETS_STYLE_URL
  return id === 'satellite' ? satellite : topoStyle()
}
