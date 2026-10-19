// Small pure helpers for the terrain profile chart.

import type { PathAnalysis } from './engine/link'

/** Round-numbered tick values inside [min, max], about `target` of them. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  const span = max - min
  if (!(span > 0)) return [min]
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const places = Math.max(0, -Math.floor(Math.log10(step)))
  const out: number[] = []
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(+(Math.round(v / step) * step).toFixed(places) + 0)
  return out
}

/** Which sample indices to draw so a chart never has more than `max` points (always includes the last). */
export function decimate(length: number, max: number): number[] {
  const stride = Math.max(1, Math.ceil(length / max))
  const out: number[] = []
  for (let i = 0; i < length; i += stride) out.push(i)
  if (out[out.length - 1] !== length - 1) out.push(length - 1)
  return out
}

export interface PointSummary {
  /** Distance from the first antenna, km. */
  km: number
  groundM: number
  /** Line of sight above the (curvature-adjusted) ground, metres; negative when the ground is in the way. */
  clearanceM: number
  /** Share of the first Fresnel zone's radius that is clear here, 0–100 (null at the antennas, where the zone has no width). */
  fresnelPct: number | null
}

export function pointSummary(path: PathAnalysis, i: number): PointSummary {
  const f = path.fresnelRadius[i]
  return {
    km: path.distKm[i],
    groundM: path.ground[i],
    clearanceM: path.clearance[i],
    fresnelPct: f > 0 ? Math.max(0, Math.min(100, (path.clearance[i] / f) * 100)) : null,
  }
}

export function describePoint(p: PointSummary): string {
  const parts = [`${p.km.toFixed(2)} km`, `ground ${p.groundM.toFixed(0)} m`]
  parts.push(p.clearanceM >= 0 ? `line of sight ${p.clearanceM.toFixed(0)} m clear` : `ground ${Math.abs(p.clearanceM).toFixed(0)} m above the line of sight`)
  if (p.fresnelPct !== null) parts.push(`Fresnel zone ${p.fresnelPct.toFixed(0)}% clear`)
  return parts.join(' · ')
}
