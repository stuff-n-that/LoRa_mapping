import { useEffect, useMemo, useRef, useState } from 'react'
import type { GridGeometry } from './engine/coverage'
import { fetchRegion, fetchRegionIndex, type ExistingNode, type RegionInfo } from './nodes'
import { renderToObjectUrl, type RenderMode } from './render'

export interface ExistingNodesState {
  index: RegionInfo[]
  indexStatus: 'loading' | 'ready' | 'unavailable'
  nodes: ExistingNode[]
  loading: string[]
  failed: Record<string, string>
}

/** Loads the region list once, then the nodes of each selected region. */
export function useExistingNodes(selected: string[]): ExistingNodesState {
  const [index, setIndex] = useState<RegionInfo[]>([])
  const [indexStatus, setIndexStatus] = useState<ExistingNodesState['indexStatus']>('loading')
  const [byRegion, setByRegion] = useState<Record<string, ExistingNode[]>>({})
  const [loading, setLoading] = useState<string[]>([])
  const [failed, setFailed] = useState<Record<string, string>>({})
  const requested = useRef(new Set<string>())

  useEffect(() => {
    const ac = new AbortController()
    fetchRegionIndex(ac.signal)
      .then((r) => {
        setIndex(r)
        setIndexStatus('ready')
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          console.warn('Region list unavailable:', err)
          setIndexStatus('unavailable')
        }
      })
    return () => ac.abort()
  }, [])

  useEffect(() => {
    for (const code of selected) {
      if (requested.current.has(code)) continue
      requested.current.add(code)
      setLoading((l) => [...l, code])
      fetchRegion(code)
        .then((nodes) => setByRegion((m) => ({ ...m, [code]: nodes })))
        .catch((err: Error) => {
          requested.current.delete(code) // allow a retry
          setFailed((f) => ({ ...f, [code]: err.message }))
        })
        .finally(() => setLoading((l) => l.filter((c) => c !== code)))
    }
  }, [selected])

  const nodes = useMemo(() => selected.flatMap((c) => byRegion[c] ?? []), [selected, byRegion])
  return { index, indexStatus, nodes, loading, failed }
}

export interface Overlay {
  url: string
  corners: GridGeometry['corners']
}

/**
 * Renders a grid of margins to an image for the map; revokes old images as the display options change.
 * `margins` is n x n, row 0 at the top (see network.combineMargins).
 */
export function useOverlay(geom: GridGeometry | null, margins: Float32Array | null, minMargin: number, mode: RenderMode): Overlay | null {
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  useEffect(() => {
    if (!geom || !margins) {
      setOverlay(null)
      return
    }
    let cancelled = false
    renderToObjectUrl(margins, geom.n, { minMargin, mode })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        setOverlay((prev) => {
          if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 1000) // let the map finish swapping
          return { url, corners: geom.corners }
        })
      })
      .catch((err) => console.error('Could not draw the coverage overlay:', err))
    return () => {
      cancelled = true
    }
  }, [geom, margins, minMargin, mode])
  return overlay
}
