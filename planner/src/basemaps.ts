import type { StyleSpecification } from 'maplibre-gl'
import { TERRAIN_ATTRIBUTION, TERRARIUM_URL } from './engine/terrain'

export type BasemapId = 'streets' | 'satellite' | 'relief'

export const BASEMAPS: { id: BasemapId; label: string }[] = [
  { id: 'streets', label: 'Streets' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'relief', label: 'Shaded relief' },
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

// Hillshade computed in the browser from the same terrain tiles the coverage
// engine uses: it also works when the street map cannot be reached.
const relief: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    dem: {
      type: 'raster-dem',
      tiles: [TERRARIUM_URL],
      tileSize: 256,
      maxzoom: 14,
      encoding: 'terrarium',
      attribution: TERRAIN_ATTRIBUTION,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#dedbd2' } },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: {
        'hillshade-exaggeration': 0.7,
        'hillshade-shadow-color': '#2f2f33',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#7d7d82',
      },
    },
  ],
}

export function styleFor(id: BasemapId): StyleSpecification | string {
  if (id === 'streets') return STREETS_STYLE_URL
  return id === 'satellite' ? satellite : relief
}
