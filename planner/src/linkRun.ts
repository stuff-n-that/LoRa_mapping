// Running a link analysis: fetch the terrain along the path, sample a profile, work out the numbers.

import { assess, analyzePath, evaluateDirection, sampleProfile, type Assessment, type DirectionResult, type PathAnalysis } from './engine/link'
import { fetchTiles, linkZoom, tilesAlongPath, TileElevation, trimCache } from './engine/terrain'
import type { LinkPlan } from './linkModel'

export interface LinkAnalysis {
  plan: LinkPlan
  path: PathAnalysis
  directions: DirectionResult[]
  assessment: Assessment
  /** True when some terrain could not be loaded and was treated as sea level. */
  missingTerrain: boolean
}

/** Everything that follows from a terrain sampler; no network. */
export function analyseWith(plan: LinkPlan, source: { sample(lat: number, lng: number): number }, missingTerrain = false): LinkAnalysis {
  const profile = sampleProfile(source, plan.a.position, plan.b.position, plan.cellM)
  const path = analyzePath(profile, plan.a.heightM, plan.b.heightM, plan.radio)
  const directions = plan.directions.map((d) => evaluateDirection(path, d))
  return { plan, path, directions, assessment: assess(path, directions, plan.mismatch), missingTerrain }
}

/** Decoded terrain kept between links, so dragging the target does not re-download what it already has. */
const tileCache = new Map<string, Float32Array | null>()
const MAX_CACHED_TILES = 300

export async function runLink(plan: LinkPlan, signal?: AbortSignal): Promise<LinkAnalysis> {
  const zoom = linkZoom(plan.a.position, plan.b.position, plan.cellM)
  const keys = tilesAlongPath(plan.a.position, plan.b.position, zoom)
  const tiles = await fetchTiles(zoom, keys, { signal, cache: tileCache })
  signal?.throwIfAborted()
  trimCache(tileCache, MAX_CACHED_TILES)
  const source = new TileElevation(zoom, tiles)
  const result = analyseWith(plan, source)
  return { ...result, missingTerrain: source.missingLookups > 0 }
}
