import type { Settings } from './settings'

export interface QuickStart {
  id: string
  label: string
  hint: string
  /** The four values it fills in: mast height, transmit power, antenna gain, cable loss. */
  patch: Pick<Settings, 'hTxM' | 'txPowerDbm' | 'txGainDbi' | 'txCableLossDb'>
}

/** Typical set-ups. Illustrative starting points, not measurements of any product. */
export const QUICK_STARTS: QuickStart[] = [
  { id: 'window', label: 'Window / balcony', hint: '5 m, small antenna', patch: { hTxM: 5, txPowerDbm: 22, txGainDbi: 2, txCableLossDb: 0 } },
  { id: 'rooftop', label: 'Rooftop node', hint: '10 m, 5.8 dBi omni', patch: { hTxM: 10, txPowerDbm: 22, txGainDbi: 5.8, txCableLossDb: 1 } },
  { id: 'hilltop', label: 'Hilltop repeater', hint: '15 m, 8 dBi collinear', patch: { hTxM: 15, txPowerDbm: 22, txGainDbi: 8, txCableLossDb: 1.5 } },
]

/**
 * The quick start whose four values are all currently set, or null. Derived from the
 * settings rather than remembered, so it clears itself as soon as any of the four is edited
 * and is right again when a shared link is opened.
 */
export function activeQuickStart(s: Settings): QuickStart | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9
  return (
    QUICK_STARTS.find(
      (q) =>
        same(s.hTxM, q.patch.hTxM) &&
        same(s.txPowerDbm, q.patch.txPowerDbm) &&
        same(s.txGainDbi, q.patch.txGainDbi) &&
        same(s.txCableLossDb, q.patch.txCableLossDb),
    ) ?? null
  )
}
