// LoRa radio assumptions: bands, named settings, receiver sensitivity and the
// link budget. Everything here is an *assumption the user can override*; the
// source of each preset is recorded so it can be re-checked.

export interface Band {
  id: string
  label: string
  /** Representative centre frequency, MHz. Propagation barely changes across a band. */
  centreMhz: number
}

export const BANDS: Band[] = [
  { id: 'us915', label: 'US / Canada 902–928 MHz', centreMhz: 915 },
  { id: 'au915', label: 'Australia / NZ 915–928 MHz', centreMhz: 921.5 },
  { id: 'eu868', label: 'EU / UK 868 MHz', centreMhz: 869.525 },
  { id: 'eu433', label: 'EU 433 MHz', centreMhz: 433.9 },
]

export interface RadioPreset {
  id: string
  network: 'meshtastic' | 'meshcore'
  label: string
  sf: number
  bwKhz: number
  /** Set when the preset itself fixes a frequency; otherwise the band centre is used. */
  freqMhz?: number
  /** Where the numbers come from, so they can be re-checked. */
  source: string
  note?: string
}

const MESHTASTIC_DOCS = 'the Meshtastic documentation (meshtastic.org).'
const MESHCORE_COMMUNITY =
  'community MeshCore guides, as MeshCore has no official list. Groups pick their own settings, so use Custom if yours differ.'

export const RADIO_PRESETS: RadioPreset[] = [
  { id: 'mt-long-fast', network: 'meshtastic', label: 'Long Fast (default) · SF11 · 250 kHz', sf: 11, bwKhz: 250, source: MESHTASTIC_DOCS },
  { id: 'mt-medium-slow', network: 'meshtastic', label: 'Medium Slow · SF10 · 250 kHz', sf: 10, bwKhz: 250, source: MESHTASTIC_DOCS },
  { id: 'mt-medium-fast', network: 'meshtastic', label: 'Medium Fast · SF9 · 250 kHz', sf: 9, bwKhz: 250, source: MESHTASTIC_DOCS },
  { id: 'mt-short-slow', network: 'meshtastic', label: 'Short Slow · SF8 · 250 kHz', sf: 8, bwKhz: 250, source: MESHTASTIC_DOCS },
  { id: 'mt-short-fast', network: 'meshtastic', label: 'Short Fast · SF7 · 250 kHz', sf: 7, bwKhz: 250, source: MESHTASTIC_DOCS },
  {
    id: 'mt-short-turbo',
    network: 'meshtastic',
    label: 'Short Turbo · SF7 · 500 kHz',
    sf: 7,
    bwKhz: 500,
    source: MESHTASTIC_DOCS,
    note: 'Not legal in all regions (500 kHz wide).',
  },
  {
    id: 'mc-us',
    network: 'meshcore',
    label: 'US / Canada common · 910.525 MHz · 62.5 kHz · SF7',
    sf: 7,
    bwKhz: 62.5,
    freqMhz: 910.525,
    source: MESHCORE_COMMUNITY,
  },
  {
    id: 'mc-eu',
    network: 'meshcore',
    label: 'EU / UK common · 869.525 MHz · 62.5 kHz · SF8',
    sf: 8,
    bwKhz: 62.5,
    freqMhz: 869.525,
    source: MESHCORE_COMMUNITY,
    note: 'Community networks use SF7–9; adjust SF under custom settings.',
  },
]

/** Demodulation SNR limit by spreading factor, dB (typical Semtech SX126x figures). */
const SNR_LIMIT_DB: Record<number, number> = { 5: -2.5, 6: -5, 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 }

/** Assumed receiver noise figure, dB. */
export const DEFAULT_NOISE_FIGURE_DB = 6

/**
 * Receiver sensitivity from the thermal noise floor:
 *   -174 dBm/Hz + 10 log10(BW) + noise figure + required SNR.
 * (SF12 / 125 kHz gives about -137 dBm, matching typical SX126x datasheets.)
 */
export function loraSensitivityDbm(sf: number, bwKhz: number, noiseFigureDb = DEFAULT_NOISE_FIGURE_DB): number {
  const snr = SNR_LIMIT_DB[Math.round(sf)]
  if (snr === undefined) throw new RangeError(`unsupported spreading factor ${sf}`)
  return -174 + 10 * Math.log10(bwKhz * 1000) + noiseFigureDb + snr
}

export interface LinkBudget {
  txPowerDbm: number
  txGainDbi: number
  txCableLossDb: number
  rxGainDbi: number
  rxCableLossDb: number
  /** Extra loss allowance for things the model does not see (foliage, buildings, enclosures), dB. */
  extraLossDb: number
}

/** EIRP of the transmitter, dBm. */
export function eirpDbm(b: Pick<LinkBudget, 'txPowerDbm' | 'txGainDbi' | 'txCableLossDb'>): number {
  return b.txPowerDbm + b.txGainDbi - b.txCableLossDb
}

/** Received power for a given basic transmission loss, dBm. */
export function receivedPowerDbm(b: LinkBudget, pathLossDb: number): number {
  return eirpDbm(b) + b.rxGainDbi - b.rxCableLossDb - b.extraLossDb - pathLossDb
}

/** The largest path loss the link can tolerate, dB. */
export function maxPathLossDb(b: LinkBudget, sensitivityDbm: number): number {
  return receivedPowerDbm(b, 0) - sensitivityDbm
}
