import { describe, expect, it } from 'vitest'
import { MARGIN_BANDS, marginRgb, renderMargins } from '../src/render'
import { parseNode } from '../src/nodes'

describe('margin colours', () => {
  it('uses the band colours in bands mode', () => {
    expect(marginRgb(0, 'bands')).toEqual([0x7b, 0x32, 0x94])
    expect(marginRgb(5.9, 'bands')).toEqual([0x7b, 0x32, 0x94])
    expect(marginRgb(6, 'bands')).toEqual([0x3a, 0x7b, 0xd5])
    expect(marginRgb(50, 'bands')).toEqual([0xf9, 0xf8, 0x71])
  })
  it('interpolates smoothly and saturates at both ends', () => {
    expect(marginRgb(0, 'smooth')).toEqual([0x7b, 0x32, 0x94])
    expect(marginRgb(100, 'smooth')).toEqual([0xf9, 0xf8, 0x71])
    const mid = marginRgb(4.5, 'smooth')
    expect(mid[0]).toBeGreaterThan(0x3a)
    expect(mid[0]).toBeLessThan(0x7b)
  })
  it('has legend bands in increasing order', () => {
    const froms = MARGIN_BANDS.map((b) => b.from)
    expect([...froms].sort((a, b) => a - b)).toEqual(froms)
  })
})

describe('rendering a margin grid', () => {
  const margins = Float32Array.from([NaN, 1.5, 11.5, 21.5, -3, 31.5])
  it('leaves empty, undefined and below-threshold pixels transparent', () => {
    const rgba = renderMargins(margins, { minMargin: 10, mode: 'bands' })
    const alpha = (i: number) => rgba[i * 4 + 3]
    expect([0, 1, 2, 3, 4, 5].map(alpha)).toEqual([0, 0, 255, 255, 0, 255])
  })
  it('shows more with a lower minimum, without needing a new calculation', () => {
    const shown = (min: number) => renderMargins(margins, { minMargin: min, mode: 'smooth' }).filter((_, i) => i % 4 === 3 && _ === 255).length
    expect(shown(0)).toBe(4)
    expect(shown(20)).toBe(2)
    expect(shown(-5)).toBe(5)
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
