import { describe, expect, it } from 'vitest'
import { DEFAULTS, effectiveFreqMhz, effectiveSensitivityDbm, parseSettings, toHash, toJob, jobKey, type Settings } from '../src/settings'

describe('settings <-> URL hash', () => {
  it('gives defaults for an empty hash', () => {
    expect(parseSettings('')).toEqual(DEFAULTS)
    expect(toHash(DEFAULTS)).toBe('')
  })

  it('round-trips a customised scenario', () => {
    const s: Settings = {
      ...DEFAULTS,
      node: { lat: 51.5074, lng: -0.1278 },
      network: 'meshcore',
      presetId: 'mc-eu',
      txPowerDbm: 27,
      txGainDbi: 5.8,
      hTxM: 25,
      hRxM: 1.5,
      extraLossDb: 6,
      radiusKm: 30,
      detail: 'fine',
      reliability: 90,
      climate: 6,
      groundId: 'poor',
      sensitivityOverride: -120,
      regions: ['GB', 'FR'],
    }
    expect(parseSettings(toHash(s))).toEqual(s)
  })

  it('round-trips custom radio settings', () => {
    const s: Settings = { ...DEFAULTS, node: { lat: 10, lng: 20 }, presetId: 'custom', sf: 9, bwKhz: 125, freqMhz: 868.1 }
    expect(parseSettings(toHash(s))).toEqual(s)
  })

  it('ignores junk and clamps out-of-range values', () => {
    const s = parseSettings('lat=abc&lng=5&tp=9999&th=-4&rk=7&net=wifi&rp=nope&dt=huge&r=gb,zzz,fr,1&sens=-5')
    expect(s.node).toBeNull()
    expect(s.txPowerDbm).toBe(36)
    expect(s.hTxM).toBe(1)
    expect(s.radiusKm).toBe(DEFAULTS.radiusKm)
    expect(s.network).toBe(DEFAULTS.network)
    expect(s.presetId).toBe(DEFAULTS.presetId)
    expect(s.detail).toBe(DEFAULTS.detail)
    expect(s.regions).toEqual(['GB', 'FR'])
    expect(s.sensitivityOverride).toBe(-60)
  })

  it('rejects coordinates outside the map', () => {
    expect(parseSettings('lat=89&lng=0').node).toBeNull()
    expect(parseSettings('lat=10&lng=200').node).toBeNull()
  })

  it('only offers presets that belong to the chosen network', () => {
    expect(parseSettings('net=meshcore&rp=mt-long-fast').presetId).toBe('mc-us')
    expect(parseSettings('net=meshtastic&rp=mc-us').presetId).toBe('mt-long-fast')
  })
})

describe('derived values', () => {
  it('uses a preset-fixed frequency, else the band centre, else the custom value', () => {
    expect(effectiveFreqMhz({ ...DEFAULTS, presetId: 'mc-us' })).toBe(910.525)
    expect(effectiveFreqMhz({ ...DEFAULTS, bandId: 'eu868' })).toBeCloseTo(869.525, 3)
    expect(effectiveFreqMhz({ ...DEFAULTS, presetId: 'custom', freqMhz: 868.1 })).toBe(868.1)
  })

  it('derives sensitivity from the radio settings unless overridden', () => {
    expect(effectiveSensitivityDbm(DEFAULTS)).toBeCloseTo(-131.5, 1)
    expect(effectiveSensitivityDbm({ ...DEFAULTS, sensitivityOverride: -120 })).toBe(-120)
  })

  it('builds a job, and its key ignores display-only changes', () => {
    const s: Settings = { ...DEFAULTS, node: { lat: 47, lng: 8 } }
    const job = toJob(s)
    expect(job.fMhz).toBe(915)
    expect(job.radiusM).toBe(20_000)
    expect(job.zoom).toBeGreaterThanOrEqual(5)
    expect(jobKey(job)).toBe(jobKey(toJob({ ...s, sensitivityOverride: -100, regions: ['CH'] })))
    expect(jobKey(job)).not.toBe(jobKey(toJob({ ...s, txPowerDbm: 14 })))
  })

  it('applies the cautious setting to both reliability and confidence', () => {
    const base: Settings = { ...DEFAULTS, node: { lat: 47, lng: 8 } }
    expect(toJob(base)).toMatchObject({ reliability: 50, confidence: 50 })
    expect(toJob({ ...base, reliability: 90 })).toMatchObject({ reliability: 90, confidence: 90 })
  })

  it('needs a node to build a job', () => {
    expect(() => toJob(DEFAULTS)).toThrow(/Place a node/)
  })
})
