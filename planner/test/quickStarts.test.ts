import { describe, expect, it } from 'vitest'
import { activeQuickStart, QUICK_STARTS } from '../src/quickStarts'
import { newNode, parseSettings, toHash, DEFAULTS, type PlannedNode } from '../src/settings'

const base = (): PlannedNode => newNode([], { lat: 51.5, lng: -0.1 })

describe('quick starts', () => {
  it('none is active for the default values', () => {
    expect(activeQuickStart(base())).toBeNull()
  })

  it('each one becomes active when applied, and only that one', () => {
    for (const q of QUICK_STARTS) {
      expect(activeQuickStart({ ...base(), ...q.patch })?.id).toBe(q.id)
    }
  })

  it('clears as soon as any of its four values is changed', () => {
    const n: PlannedNode = { ...base(), ...QUICK_STARTS[1].patch }
    expect(activeQuickStart({ ...n, hTxM: n.hTxM + 1 })).toBeNull()
    expect(activeQuickStart({ ...n, txPowerDbm: 20 })).toBeNull()
    expect(activeQuickStart({ ...n, txGainDbi: 6 })).toBeNull()
    expect(activeQuickStart({ ...n, txCableLossDb: 2 })).toBeNull()
  })

  it('ignores everything a quick start does not touch', () => {
    const n: PlannedNode = { ...base(), ...QUICK_STARTS[0].patch, network: 'meshcore', presetId: 'mc-eu', name: 'Hill' }
    expect(activeQuickStart(n)?.id).toBe(QUICK_STARTS[0].id)
  })

  it('is judged per node, so each node shows its own', () => {
    const a: PlannedNode = { ...base(), ...QUICK_STARTS[0].patch }
    const b: PlannedNode = { ...newNode([a], { lat: 51.6, lng: -0.1 }), ...QUICK_STARTS[2].patch }
    expect([a, b].map((n) => activeQuickStart(n)?.id)).toEqual([QUICK_STARTS[0].id, QUICK_STARTS[2].id])
  })

  it('is still active after a round trip through a shared link', () => {
    const n: PlannedNode = { ...base(), ...QUICK_STARTS[2].patch }
    const back = parseSettings(toHash({ ...DEFAULTS, nodes: [n] })).nodes[0]
    expect(activeQuickStart(back)?.id).toBe(QUICK_STARTS[2].id)
  })

  it('has distinct values, so at most one can match', () => {
    const keys = QUICK_STARTS.map((q) => JSON.stringify(q.patch))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
