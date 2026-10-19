/// <reference lib="webworker" />
// Computes a share of the raster rows. Each worker builds its own copy of the
// local elevation grid from the terrain tiles it is sent, so there is no shared
// memory and no special server headers are needed.

import { computeRow, createContext, type CoverageJob } from './coverage'
import { buildDem, TileElevation } from './terrain'

export interface WorkerRequest {
  type: 'run'
  job: CoverageJob
  tiles: [string, Float32Array][]
  rows: number[]
}

export type WorkerMessage =
  | { type: 'progress'; rowsDone: number }
  | { type: 'done'; rows: number[]; data: Float32Array; missingTerrainLookups: number }
  | { type: 'error'; message: string }

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  if (req.type !== 'run') return
  try {
    const { job, rows } = req
    const source = new TileElevation(job.zoom, new Map(req.tiles))
    const dem = buildDem(source, job.origin, job.radiusM, job.demCellM)
    const ctx = createContext(job, dem)
    const n = ctx.geom.n
    const out = new Float32Array(rows.length * n)
    const row = new Float32Array(n)
    let lastReport = performance.now()
    for (let i = 0; i < rows.length; i++) {
      computeRow(ctx, rows[i], row)
      out.set(row, i * n)
      const now = performance.now()
      if (now - lastReport > 80) {
        post({ type: 'progress', rowsDone: i + 1 })
        lastReport = now
      }
    }
    post({ type: 'done', rows, data: out, missingTerrainLookups: source.missingLookups }, [out.buffer])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
