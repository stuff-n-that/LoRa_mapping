import { describe, expect, it } from 'vitest'
import { buildLinkPlan, linkPlanKey, radioMismatch } from '../src/linkModel'
import { DEFAULTS, newNode, type PlannedNode, type Settings } from '../src/settings'

const here = { lat: 51.5, lng: -0.1 }
const mk = (over: Partial<PlannedNode> = {}, pos = here, existing: PlannedNode[] = []): PlannedNode => ({ ...newNode(existing, pos), ...over })
const a = mk({ name: 'Hill', txPowerDbm: 27, txGainDbi: 8, txCableLossDb: 1.5, hTxM: 30 })
const b = { ...mk({ name: 'Barn', txPowerDbm: 14, txGainDbi: 2, txCableLossDb: 0.5, hTxM: 6 }, { lat: 51.55, lng: -0.05 }, [a]), id: 'n2' }
const plan = (over: Partial<Settings>): Settings => ({ ...DEFAULTS, nodes: [a, b], ...over })

describe('building a link', () => {
  it('waits for a target point, and for nodes that exist', () => {
    expect(buildLinkPlan(plan({ link: null }))).toEqual({ ok: false, reason: 'missing-node' })
    expect(buildLinkPlan(plan({ link: { from: 'n1', to: { kind: 'point', position: null } } }))).toEqual({ ok: false, reason: 'pick-target' })
    expect(buildLinkPlan(plan({ link: { from: 'n9', to: { kind: 'point', position: here } } }))).toEqual({ ok: false, reason: 'missing-node' })
    expect(buildLinkPlan(plan({ link: { from: 'n1', to: { kind: 'node', id: 'n9' } } }))).toEqual({ ok: false, reason: 'missing-node' })
    expect(buildLinkPlan(plan({ link: { from: 'n1', to: { kind: 'node', id: 'n1' } } }))).toEqual({ ok: false, reason: 'same-node' })
  })

  it('a node to a point uses the shared receiving-device settings, one way', () => {
    const r = buildLinkPlan(plan({ hRxM: 1.5, rxGainDbi: 3, rxCableLossDb: 0.4, extraLossDb: 5, link: { from: 'n1', to: { kind: 'point', position: { lat: 51.6, lng: 0 } } } }))
    if (!r.ok) throw new Error('expected a plan')
    expect(r.plan.bIsNode).toBe(false)
    expect(r.plan.b).toMatchObject({ name: 'Target', heightM: 1.5 })
    expect(r.plan.a).toMatchObject({ name: 'Hill', heightM: 30 })
    expect(r.plan.directions).toHaveLength(1)
    expect(r.plan.directions[0].budget).toMatchObject({ txPowerDbm: 27, txGainDbi: 8, txCableLossDb: 1.5, rxGainDbi: 3, rxCableLossDb: 0.4, extraLossDb: 5 })
    expect(r.plan.directions[0].sensitivityDbm).toBeCloseTo(-131.5, 1)
    expect(r.plan.mismatch).toBeNull()
  })

  it('a node to a node runs both ways, each with its own power, antenna and sensitivity', () => {
    const r = buildLinkPlan(plan({ link: { from: 'n1', to: { kind: 'node', id: 'n2' } } }))
    if (!r.ok) throw new Error('expected a plan')
    expect(r.plan.bIsNode).toBe(true)
    expect(r.plan.directions.map((d) => d.label)).toEqual(['Hill to Barn', 'Barn to Hill'])
    const [ab, ba] = r.plan.directions
    expect(ab.budget).toMatchObject({ txPowerDbm: 27, txGainDbi: 8, rxGainDbi: 2, rxCableLossDb: 0.5 })
    expect(ba.budget).toMatchObject({ txPowerDbm: 14, txGainDbi: 2, rxGainDbi: 8, rxCableLossDb: 1.5 })
    expect(r.plan.b.heightM).toBe(6)
  })

  it('uses each receiver’s own radio for its sensitivity, unless one is set by hand', () => {
    const mc = { ...b, network: 'meshcore' as const, presetId: 'mc-us' }
    const r = buildLinkPlan({ ...DEFAULTS, nodes: [a, mc], link: { from: 'n1', to: { kind: 'node', id: 'n2' } } })
    if (!r.ok) throw new Error('expected a plan')
    expect(r.plan.directions[0].sensitivityDbm).toBeCloseTo(-127.5, 1) // heard by the MeshCore node
    expect(r.plan.directions[1].sensitivityDbm).toBeCloseTo(-131.5, 1)
    const forced = buildLinkPlan({ ...DEFAULTS, sensitivityOverride: -120, nodes: [a, mc], link: { from: 'n1', to: { kind: 'node', id: 'n2' } } })
    if (!forced.ok) throw new Error('expected a plan')
    expect(forced.plan.directions.map((d) => d.sensitivityDbm)).toEqual([-120, -120])
  })

  it('says when two nodes cannot hear each other', () => {
    expect(radioMismatch(a, b)).toBeNull()
    expect(radioMismatch(a, { ...b, presetId: 'mt-short-fast' })).toMatch(/Hill: SF11, 250 kHz, 915 MHz vs Barn: SF7, 250 kHz, 915 MHz/)
    expect(radioMismatch(a, { ...b, network: 'meshcore', presetId: 'mc-us' })).not.toBeNull()
    expect(radioMismatch(a, { ...b, bandId: 'eu868' })).not.toBeNull() // different frequency
    const r = buildLinkPlan({ ...DEFAULTS, nodes: [a, { ...b, presetId: 'mt-short-fast' }], link: { from: 'n1', to: { kind: 'node', id: 'n2' } } })
    expect(r.ok && r.plan.mismatch).toBeTruthy()
  })

  it('has a key that changes only when something that matters changes', () => {
    const key = (s: Settings) => {
      const r = buildLinkPlan(s)
      if (!r.ok) throw new Error('expected a plan')
      return linkPlanKey(r.plan)
    }
    const link = { from: 'n1', to: { kind: 'node' as const, id: 'n2' } }
    const base = key(plan({ link }))
    expect(key(plan({ link, regions: ['GB'], radiusKm: 50 }))).toBe(base) // coverage-only settings
    expect(key(plan({ link, extraLossDb: 6 }))).not.toBe(base)
    expect(key({ ...plan({ link }), nodes: [{ ...a, hTxM: 31 }, b] })).not.toBe(base)
    expect(key({ ...plan({ link }), nodes: [a, { ...b, position: { lat: 51.56, lng: -0.05 } }] })).not.toBe(base)
  })
})
