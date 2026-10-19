// Orchestration: download terrain, then compute the raster across a pool of workers.

import { gridGeometry, computeCoverageInline, type CoverageJob, type CoverageResult } from './coverage'
import type { WorkerMessage, WorkerRequest } from './coverage.worker'
import { chooseZoom, fetchTiles, pixelSizeM, tilesCovering } from './terrain'
import type { LatLng } from './geo'

export type Phase = 'terrain' | 'compute'

export interface RunOptions {
  signal?: AbortSignal
  /** fraction is 0..1 within the phase. */
  onProgress?: (phase: Phase, fraction: number) => void
  /** Override the worker count (0 = compute on the calling thread). */
  workers?: number
}

/** Terrain settings for a detail level and range. */
export function terrainPlan(origin: LatLng, radiusM: number, targetCellM: number): { zoom: number; demCellM: number; tileCount: number } {
  const zoom = chooseZoom({ centre: origin, radiusM, targetCellM })
  return {
    zoom,
    demCellM: Math.max(20, Math.round(pixelSizeM(zoom, origin.lat))),
    tileCount: tilesCovering(origin, radiusM, zoom).length,
  }
}

function defaultWorkerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  // Each worker holds its own copy of the elevation grid, so keep the pool smaller on phones.
  const mobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  return Math.max(1, Math.min(mobile ? 3 : 6, hc - 1))
}

function abortError(): Error {
  return new DOMException('Coverage run cancelled', 'AbortError')
}

export async function runCoverage(job: CoverageJob, opts: RunOptions = {}): Promise<CoverageResult> {
  const { signal, onProgress } = opts
  const t0 = performance.now()

  // 1. terrain
  const keys = tilesCovering(job.origin, job.radiusM, job.zoom)
  onProgress?.('terrain', 0)
  const tiles = await fetchTiles(job.zoom, keys, {
    signal,
    onProgress: (done, total) => onProgress?.('terrain', done / total),
  })
  signal?.throwIfAborted()

  // 2. compute
  const geom = gridGeometry(job.origin, job.radiusM, job.outCellM)
  const n = geom.n
  const workerCount = opts.workers ?? (typeof Worker === 'undefined' ? 0 : defaultWorkerCount())
  onProgress?.('compute', 0)

  if (workerCount <= 0) {
    const result = computeCoverageInline(job, tiles)
    onProgress?.('compute', 1)
    return { ...result, elapsedMs: performance.now() - t0 }
  }

  const k = Math.min(workerCount, n)
  const data = new Float32Array(n * n)
  const rowsDone = new Array<number>(k).fill(0)
  let missing = 0
  const tileEntries = [...tiles.entries()]

  const workers: Worker[] = []
  const cleanup = () => workers.forEach((w) => w.terminate())

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError())
      signal?.addEventListener('abort', () => reject(abortError()), { once: true })

      let finished = 0
      for (let w = 0; w < k; w++) {
        const worker = new Worker(new URL('./coverage.worker.ts', import.meta.url), { type: 'module' })
        workers.push(worker)
        const rows: number[] = []
        for (let r = w; r < n; r += k) rows.push(r) // interleaved rows balance the load
        worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
          const m = ev.data
          if (m.type === 'progress') {
            rowsDone[w] = m.rowsDone
            onProgress?.('compute', rowsDone.reduce((a, b) => a + b, 0) / n)
          } else if (m.type === 'done') {
            m.rows.forEach((row, i) => data.set(m.data.subarray(i * n, (i + 1) * n), row * n))
            missing += m.missingTerrainLookups
            rowsDone[w] = m.rows.length
            if (++finished === k) resolve()
          } else {
            reject(new Error(m.message))
          }
        }
        worker.onerror = (e) => reject(new Error(e.message || 'worker failed'))
        const req: WorkerRequest = { type: 'run', job, tiles: tileEntries, rows }
        worker.postMessage(req)
      }
    })
  } finally {
    cleanup()
  }

  onProgress?.('compute', 1)
  return { job, geom, data, missingTerrainLookups: missing, elapsedMs: performance.now() - t0 }
}
