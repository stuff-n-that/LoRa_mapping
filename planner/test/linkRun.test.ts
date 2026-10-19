import { describe, expect, it } from 'vitest'
import { analyseWith } from '../src/linkRun'
import { buildLinkPlan } from '../src/linkModel'
import { DEFAULTS, newNode, type Settings } from '../src/settings'

const a = newNode([], { lat: 51.5, lng: -0.1 })
const b = { ...newNode([a], { lat: 51.56, lng: -0.1 }), id: 'n2' }
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, nodes: [a, b], ...over })
const planFor = (s: Settings) => {
  const r = buildLinkPlan(s)
  if (!r.ok) throw new Error('expected a plan')
  return r.plan
}

describe('analysing a planned link', () => {
  it('flat ground between two nodes: clear, both ways equal, a verdict', () => {
    const plan = planFor(settings({ link: { from: 'n1', to: { kind: 'node', id: 'n2' } } }))
    const r = analyseWith(plan, { sample: () => 100 })
    expect(r.path.losClear).toBe(true)
    expect(r.directions).toHaveLength(2)
    expect(r.directions[0].marginDb).toBeCloseTo(r.directions[1].marginDb, 6)
    expect(['good', 'marginal']).toContain(r.assessment.verdict)
    expect(r.missingTerrain).toBe(false)
  })

  it('a ridge across the middle blocks the line of sight and lowers the verdict', () => {
    const plan = planFor(settings({ link: { from: 'n1', to: { kind: 'node', id: 'n2' } } }))
    const ridge = { sample: (lat: number) => (Math.abs(lat - 51.53) < 0.004 ? 400 : 100) }
    const flat = analyseWith(plan, { sample: () => 100 })
    const r = analyseWith(plan, ridge)
    expect(r.path.losClear).toBe(false)
    expect(r.assessment.verdict).not.toBe('good')
    expect(r.directions[0].marginDb).toBeLessThan(flat.directions[0].marginDb)
  })

  it('mismatched radios make the link impossible whatever the terrain', () => {
    const odd = { ...b, presetId: 'custom', sf: 7 }
    const plan = planFor({ ...settings({ link: { from: 'n1', to: { kind: 'node', id: 'n2' } } }), nodes: [a, odd] })
    expect(plan.mismatch).not.toBeNull()
    expect(analyseWith(plan, { sample: () => 100 }).assessment.verdict).toBe('poor')
  })
})
