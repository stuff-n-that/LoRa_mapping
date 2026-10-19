import { describe, expect, it } from 'vitest'
import { activeQuickStart, QUICK_STARTS } from '../src/quickStarts'
import { DEFAULTS, parseSettings, toHash, type Settings } from '../src/settings'

describe('quick starts', () => {
  it('none is active for the default values', () => {
    expect(activeQuickStart(DEFAULTS)).toBeNull()
  })

  it('each one becomes active when applied, and only that one', () => {
    for (const q of QUICK_STARTS) {
      const applied: Settings = { ...DEFAULTS, ...q.patch }
      expect(activeQuickStart(applied)?.id).toBe(q.id)
    }
  })

  it('clears as soon as any of its four values is changed', () => {
    const base: Settings = { ...DEFAULTS, ...QUICK_STARTS[1].patch }
    expect(activeQuickStart({ ...base, hTxM: base.hTxM + 1 })).toBeNull()
    expect(activeQuickStart({ ...base, txPowerDbm: 20 })).toBeNull()
    expect(activeQuickStart({ ...base, txGainDbi: 6 })).toBeNull()
    expect(activeQuickStart({ ...base, txCableLossDb: 2 })).toBeNull()
  })

  it('ignores settings a quick start does not touch', () => {
    const s: Settings = { ...DEFAULTS, ...QUICK_STARTS[0].patch, radiusKm: 50, network: 'meshcore', extraLossDb: 8 }
    expect(activeQuickStart(s)?.id).toBe(QUICK_STARTS[0].id)
  })

  it('is still active after a round trip through a shared link', () => {
    const s: Settings = { ...DEFAULTS, node: { lat: 51.5, lng: -0.1 }, ...QUICK_STARTS[2].patch }
    expect(activeQuickStart(parseSettings(toHash(s)))?.id).toBe(QUICK_STARTS[2].id)
  })

  it('has distinct values, so at most one can match', () => {
    const keys = QUICK_STARTS.map((q) => JSON.stringify(q.patch))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
