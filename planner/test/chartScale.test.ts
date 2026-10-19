import { describe, expect, it } from 'vitest'
import { decimate, describePoint, niceTicks, pointSummary } from '../src/chartScale'
import { analyzePath, type PathRadio } from '../src/engine/link'

const radio: PathRadio = { fMhz: 915, climate: 5, n0: 301, pol: 1, epsilon: 15, sigma: 0.005, mdvar: 3, reliability: 50, confidence: 50 }

describe('axis ticks', () => {
  it('chooses round numbers inside the range', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(0, 8.24, 4)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(120, 480, 4)).toEqual([200, 300, 400])
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
  it('copes with a flat or invalid range', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(0, NaN)).toEqual([])
    for (const t of niceTicks(-37, 412, 5)) {
      expect(t).toBeGreaterThanOrEqual(-37)
      expect(t).toBeLessThanOrEqual(412)
    }
  })
})

describe('decimating samples', () => {
  it('keeps everything when short, and always the last point when long', () => {
    expect(decimate(5, 300)).toEqual([0, 1, 2, 3, 4])
    const d = decimate(1001, 300)
    expect(d.length).toBeLessThanOrEqual(302)
    expect(d[0]).toBe(0)
    expect(d[d.length - 1]).toBe(1000)
  })
})

describe('describing a point on the path', () => {
  const np = 100
  const elevation = Float64Array.from({ length: np + 1 }, (_, i) => (i === 50 ? 340 : 300))
  const path = analyzePath({ distanceM: 10_000, elevation }, 10, 10, radio)

  it('says how much the line of sight clears, or is blocked by', () => {
    const clear = pointSummary(path, 20)
    expect(clear.km).toBeCloseTo(2, 6)
    expect(clear.groundM).toBe(300)
    expect(clear.clearanceM).toBeGreaterThan(5)
    expect(describePoint(clear)).toMatch(/^2\.00 km · ground 300 m · line of sight \d+ m clear · Fresnel zone \d+% clear$/)
    const blocked = pointSummary(path, 50)
    expect(blocked.clearanceM).toBeLessThan(0)
    expect(blocked.fresnelPct).toBe(0)
    expect(describePoint(blocked)).toMatch(/ground \d+ m above the line of sight/)
  })

  it('has no Fresnel width at the antennas', () => {
    expect(pointSummary(path, 0).fresnelPct).toBeNull()
    expect(describePoint(pointSummary(path, 0))).not.toContain('Fresnel')
  })
})
