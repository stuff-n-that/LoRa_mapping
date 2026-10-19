import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { decimate, describePoint, niceTicks, pointSummary } from '../chartScale'
import type { PathAnalysis } from '../engine/link'

interface Props {
  path: PathAnalysis
  /** Index of the point under the cursor (also moves a ring along the map line). */
  onCursor: (index: number | null) => void
  cursor: number | null
  nameA: string
  nameB: string
}

const W = 360
const H = 190
const M = { l: 42, r: 10, t: 10, b: 24 }
const MAX_DRAWN = 400

/** Terrain, line of sight and first Fresnel zone along the path. */
export default function ProfileChart({ path, onCursor, cursor, nameA, nameB }: Props) {
  const [focused, setFocused] = useState(false)
  const np = path.distKm.length - 1

  const geometry = useMemo(() => {
    const idx = decimate(path.distKm.length, MAX_DRAWN)
    const lowerFresnel = (i: number) => path.los[i] - path.fresnelRadius[i]
    let lo = Infinity
    let hi = -Infinity
    for (const i of idx) {
      lo = Math.min(lo, path.groundCurved[i], lowerFresnel(i))
      hi = Math.max(hi, path.los[i] + path.fresnelRadius[i], path.groundCurved[i])
    }
    lo = Math.min(lo, path.topA, path.topB)
    const pad = Math.max(5, (hi - lo) * 0.06)
    const yMin = Math.floor((lo - pad) / 10) * 10
    const yMax = hi + pad
    const x = (km: number) => M.l + (km / path.distKm[np]) * (W - M.l - M.r)
    const y = (m: number) => H - M.b - ((m - yMin) / (yMax - yMin)) * (H - M.t - M.b)
    const line = (f: (i: number) => number) => idx.map((i, k) => `${k ? 'L' : 'M'}${x(path.distKm[i]).toFixed(1)},${y(f(i)).toFixed(1)}`).join('')
    const base = y(yMin)
    const groundD = `${line((i) => path.groundCurved[i])}L${x(path.distKm[np])},${base}L${x(0)},${base}Z`
    return {
      x,
      y,
      yTicks: niceTicks(yMin, yMax, 4),
      xTicks: niceTicks(0, path.distKm[np], 5),
      groundD,
      losD: line((i) => path.los[i]),
      upperD: line((i) => path.los[i] + path.fresnelRadius[i]),
      lowerD: line(lowerFresnel),
    }
  }, [path, np])

  const at = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const frac = (px - M.l) / (W - M.l - M.r)
    return Math.max(0, Math.min(np, Math.round(frac * np)))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const big = Math.max(1, Math.round(np / 20))
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'PageDown' ? big : e.key === 'PageUp' ? -big : 0
    if (e.key === 'Home') onCursor(0)
    else if (e.key === 'End') onCursor(np)
    else if (step) onCursor(Math.max(0, Math.min(np, (cursor ?? Math.round(np / 2)) + step)))
    else return
    e.preventDefault()
  }

  const summary = cursor !== null ? pointSummary(path, cursor) : null
  const blockedIdx = !path.losClear ? path.blockingIndex : null
  return (
    <figure className="profile">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`Terrain profile from ${nameA} to ${nameB}, ${path.distKm[np].toFixed(2)} km. Use the arrow keys to move along the path.`}
        onPointerMove={(e) => onCursor(at(e))}
        onPointerDown={(e) => onCursor(at(e))}
        onPointerLeave={() => !focused && onCursor(null)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          onCursor(null)
        }}
        onKeyDown={onKey}
      >
        {geometry.yTicks.map((t) => (
          <g key={`y${t}`} className="grid">
            <line x1={M.l} x2={W - M.r} y1={geometry.y(t)} y2={geometry.y(t)} />
            <text x={M.l - 5} y={geometry.y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {geometry.xTicks.map((t) => (
          <text key={`x${t}`} className="axis" x={geometry.x(t)} y={H - 8} textAnchor="middle">
            {t}
          </text>
        ))}
        <path className="fresnel-edge" d={geometry.upperD} />
        <path className="fresnel-edge" d={geometry.lowerD} />
        <path className="ground" d={geometry.groundD} />
        <path className="los" d={geometry.losD} />
        {[
          { km: 0, top: path.topA, ground: path.ground[0] },
          { km: path.distKm[np], top: path.topB, ground: path.ground[np] },
        ].map((m, i) => (
          <g key={i} className="mast">
            <line x1={geometry.x(m.km)} x2={geometry.x(m.km)} y1={geometry.y(m.ground)} y2={geometry.y(m.top)} />
            <circle cx={geometry.x(m.km)} cy={geometry.y(m.top)} r={3} />
          </g>
        ))}
        {blockedIdx !== null && <circle className="block" cx={geometry.x(path.distKm[blockedIdx])} cy={geometry.y(path.groundCurved[blockedIdx])} r={4} />}
        {cursor !== null && (
          <g className="cursor">
            <line x1={geometry.x(path.distKm[cursor])} x2={geometry.x(path.distKm[cursor])} y1={M.t} y2={H - M.b} />
            <circle cx={geometry.x(path.distKm[cursor])} cy={geometry.y(path.groundCurved[cursor])} r={3.5} />
          </g>
        )}
      </svg>
      <figcaption>
        <span>Height (m) over distance (km)</span>
        <span className="key ground-key">Terrain</span>
        <span className="key los-key">Line of sight</span>
        <span className="key fresnel-key">First Fresnel zone</span>
      </figcaption>
      <div className="profile-readout" aria-live="polite">
        {summary ? describePoint(summary) : 'Move along the chart to read any point; the matching spot is marked on the map.'}
      </div>
    </figure>
  )
}
