import { describe, expect, it } from 'vitest'
import type { CoverageResult } from '../src/engine/coverage'
import { MARGIN_BANDS, marginRgb, renderRgba, summarize } from '../src/render'
import { parseNode } from '../src/nodes'

/** A small fake result: n x n, radius 5 km, values supplied by the caller. */
function fake(n: number, f: (row: number, col: number) => number): CoverageResult {
  const data = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) data[r * n + c] = f(r, c)
  return {
    job: { radiusM: 5000 } as CoverageResult['job'],
    geom: { n, uMin: 0, vMin: 0, uSize: 1, corners: [[0, 0], [0, 0], [0, 0], [0, 0]] },
    data,
    missingTerrainLookups: 0,
    elapsedMs: 0,
  }
}

describe('margin colours', () => {
  it('uses the band colours in bands mode', () => {
    expect(marginRgb(0, 'bands')).toEqual([0x7b, 0x32, 0x94])
    expect(marginRgb(5.9, 'bands')).toEqual([0x7b, 0x32, 0x94])
    expect(marginRgb(6, 'bands')).toEqual([0x3a, 0x7b, 0xd5])
    expect(marginRgb(50, 'bands')).toEqual([0xf9, 0xf8, 0x71])
  })
  it('interpolates smoothly and saturates at both ends', () => {
    const low = marginRgb(0, 'smooth')
    const high = marginRgb(100, 'smooth')
    expect(low).toEqual([0x7b, 0x32, 0x94])
    expect(high).toEqual([0xf9, 0xf8, 0x71])
    const mid = marginRgb(4.5, 'smooth')
    expect(mid[0]).toBeGreaterThan(0x3a)
    expect(mid[0]).toBeLessThan(0x7b)
  })
  it('has legend bands in increasing order', () => {
    const froms = MARGIN_BANDS.map((b) => b.from)
    expect([...froms].sort((a, b) => a - b)).toEqual(froms)
  })
})

describe('rendering', () => {
  const result = fake(4, (r, c) => (r === 0 ? NaN : -130 + c * 10)) // margins vs -131.5: 1.5, 11.5, 21.5, 31.5 in rows 1-3
  it('leaves empty, undefined and below-threshold pixels transparent', () => {
    const rgba = renderRgba(result, { sensitivityDbm: -131.5, minMargin: 10, mode: 'bands' })
    const alpha = (r: number, c: number) => rgba[(r * 4 + c) * 4 + 3]
    expect(alpha(0, 3)).toBe(0) // NaN
    expect(alpha(1, 0)).toBe(0) // margin 1.5 < 10
    expect(alpha(1, 1)).toBe(255) // margin 11.5
    expect(alpha(2, 3)).toBe(255)
  })
  it('re-renders against a different sensitivity without a new result', () => {
    const a = renderRgba(result, { sensitivityDbm: -131.5, minMargin: 0, mode: 'bands' })
    const b = renderRgba(result, { sensitivityDbm: -120, minMargin: 0, mode: 'bands' })
    const covered = (px: Uint8ClampedArray) => px.filter((_, i) => i % 4 === 3 && px[i] === 255).length
    expect(covered(b)).toBeLessThan(covered(a))
  })
})

describe('summary', () => {
  it('counts area and reach from pixel margins', () => {
    // 5 km radius over 10 px => 1 km per pixel; everything inside has margin 10 dB
    const r = fake(10, () => -121.5)
    const s = summarize(r, -131.5)
    expect(s.areaKm2).toBeCloseTo(100, 6)
    expect(s.coveredFraction).toBe(1)
    expect(s.maxMargin).toBeCloseTo(10, 5)
    expect(s.reachKm).toBeGreaterThan(6) // corner pixel centre from the middle
    const none = summarize(r, -100)
    expect(none.areaKm2).toBe(0)
    expect(none.reachKm).toBe(0)
  })
  it('ignores undefined pixels when working out the covered share', () => {
    const r = fake(10, (_row, col) => (col < 5 ? NaN : -121.5))
    const s = summarize(r, -131.5)
    expect(s.coveredFraction).toBe(1)
    expect(s.areaKm2).toBeCloseTo(50, 6)
  })
})

describe('existing-node parsing', () => {
  it('accepts well-formed records and fills defaults', () => {
    const n = parseNode({ id: 'a', name: 'Hill', network: 'meshcore', lat: 51.5, lng: -0.1, roleCategory: 'repeater' }, 0)
    expect(n).toMatchObject({ id: 'a', name: 'Hill', network: 'meshcore', roleCategory: 'repeater', roleRaw: null, lastSeen: '' })
    expect(parseNode({ network: 'meshtastic', lat: '1', lng: '2' }, 7)).toMatchObject({ id: 'meshtastic-7', name: 'Unnamed node', roleCategory: 'other' })
  })
  it('rejects bad coordinates and unknown networks', () => {
    expect(parseNode({ network: 'meshcore', lat: 'x', lng: 1 }, 0)).toBeNull()
    expect(parseNode({ network: 'meshcore', lat: 91, lng: 1 }, 0)).toBeNull()
    expect(parseNode({ network: 'lorawan', lat: 1, lng: 1 }, 0)).toBeNull()
    expect(parseNode({ network: 'meshcore', lat: null, lng: null }, 0)).toBeNull()
  })
})
