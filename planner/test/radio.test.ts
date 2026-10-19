import { describe, expect, it } from 'vitest'
import { eirpDbm, loraSensitivityDbm, maxPathLossDb, RADIO_PRESETS, receivedPowerDbm, type LinkBudget } from '../src/engine/radio'

describe('LoRa sensitivity', () => {
  it('matches datasheet-style figures', () => {
    // SX126x: about -137 dBm at SF12 / 125 kHz
    expect(loraSensitivityDbm(12, 125)).toBeCloseTo(-137, 0)
    // LongFast: SF11 / 250 kHz
    expect(loraSensitivityDbm(11, 250)).toBeCloseTo(-131.5, 1)
  })

  it('gets worse with more bandwidth and better with higher SF', () => {
    expect(loraSensitivityDbm(11, 500)).toBeGreaterThan(loraSensitivityDbm(11, 125))
    expect(loraSensitivityDbm(12, 250)).toBeLessThan(loraSensitivityDbm(7, 250))
  })

  it('rejects an unsupported spreading factor', () => {
    expect(() => loraSensitivityDbm(4, 125)).toThrow(RangeError)
  })

  it('has a usable sensitivity for every shipped preset', () => {
    for (const p of RADIO_PRESETS) {
      const s = loraSensitivityDbm(p.sf, p.bwKhz)
      expect(s).toBeLessThan(-110)
      expect(s).toBeGreaterThan(-145)
    }
  })
})

describe('link budget', () => {
  const b: LinkBudget = { txPowerDbm: 22, txGainDbi: 3, txCableLossDb: 1, rxGainDbi: 2, rxCableLossDb: 0.5, extraLossDb: 4 }
  it('adds up EIRP, received power and the tolerable loss', () => {
    expect(eirpDbm(b)).toBe(24)
    expect(receivedPowerDbm(b, 130)).toBeCloseTo(24 + 2 - 0.5 - 4 - 130, 9)
    expect(maxPathLossDb(b, -131.5)).toBeCloseTo(21.5 + 131.5, 9)
  })
})
