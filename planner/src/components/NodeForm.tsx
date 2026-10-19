import { BANDS, RADIO_PRESETS, eirpDbm, loraSensitivityDbm } from '../engine/radio'
import type { LatLng } from '../engine/geo'
import {
  effectiveFreqMhz,
  effectiveRadio,
  effectiveSensitivityDbm,
  linkBudget,
  presetFor,
  type Network,
  type Settings,
} from '../settings'
import { Field, NumberField, Section, Segmented } from './ui'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClearNode: () => void
  onUseLocation: () => void
  locating: boolean
  locationError: string | null
}

const QUICK_STARTS: { label: string; hint: string; patch: Partial<Settings> }[] = [
  { label: 'Window / balcony', hint: '5 m, small antenna', patch: { hTxM: 5, txPowerDbm: 22, txGainDbi: 2, txCableLossDb: 0 } },
  { label: 'Rooftop node', hint: '10 m, 5.8 dBi omni', patch: { hTxM: 10, txPowerDbm: 22, txGainDbi: 5.8, txCableLossDb: 1 } },
  { label: 'Hilltop repeater', hint: '15 m, 8 dBi collinear', patch: { hTxM: 15, txPowerDbm: 22, txGainDbi: 8, txCableLossDb: 1.5 } },
]

const SF_OPTIONS = [5, 6, 7, 8, 9, 10, 11, 12]
const BW_OPTIONS = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

const fmt = (n: number) => `${n > 0 ? '' : ''}${n.toFixed(1)}`

export default function NodeForm({ settings: s, onChange, onClearNode, onUseLocation, locating, locationError }: Props) {
  const preset = presetFor(s.presetId)
  const radio = effectiveRadio(s)
  const freq = effectiveFreqMhz(s)
  const sensitivity = effectiveSensitivityDbm(s)
  const eirp = eirpDbm(linkBudget(s))
  const presets = RADIO_PRESETS.filter((p) => p.network === s.network)

  const setNetwork = (network: Network) => {
    const first = RADIO_PRESETS.find((p) => p.network === network)
    onChange({ network, presetId: first ? first.id : 'custom' })
  }

  const summary = s.node ? `${s.node.lat.toFixed(3)}, ${s.node.lng.toFixed(3)}` : 'click the map to place'

  return (
    <Section title="Your node" summary={summary} defaultOpen>
      <div className="field">
        <span className="label">Location</span>
        {s.node ? (
          <div className="row">
            <NumberField value={s.node.lat} min={-85} max={85} step={0.00001} decimals={5} onChange={(lat) => onChange({ node: { lat, lng: (s.node as LatLng).lng } })} unit="lat" />
            <NumberField value={s.node.lng} min={-180} max={180} step={0.00001} decimals={5} onChange={(lng) => onChange({ node: { lat: (s.node as LatLng).lat, lng } })} unit="lng" />
          </div>
        ) : (
          <p className="note">Click the map to place your node, or use your current location.</p>
        )}
        <div className="row">
          <button type="button" className="btn small" onClick={onUseLocation} disabled={locating}>
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          {s.node && (
            <button type="button" className="btn small ghost" onClick={onClearNode}>
              Remove node
            </button>
          )}
        </div>
        {locationError && <p className="note warn">{locationError}</p>}
        {s.node && <div className="hint">Drag the pin to move it.</div>}
      </div>

      <div className="field">
        <span className="label">Quick start</span>
        <div className="quick">
          {QUICK_STARTS.map((q) => (
            <button key={q.label} type="button" className="btn small" title={q.hint} onClick={() => onChange(q.patch)}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="hint">Typical values for the antenna and mast. Adjust to your own gear below.</div>
      </div>

      <div className="field">
        <span className="label">Network</span>
        <Segmented
          label="Network"
          value={s.network}
          onChange={setNetwork}
          options={[
            { id: 'meshtastic', label: 'Meshtastic' },
            { id: 'meshcore', label: 'MeshCore' },
          ]}
        />
      </div>

      <Field label="Radio settings" hint={preset?.note}>
        {(id) => (
          <select id={id} value={s.presetId} onChange={(e) => onChange({ presetId: e.target.value })}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom (spreading factor / bandwidth)</option>
          </select>
        )}
      </Field>
      {preset && <div className="hint">Source: {preset.source}</div>}

      {s.presetId === 'custom' && (
        <div className="row">
          <Field label="Spreading factor">
            {(id) => (
              <select id={id} value={s.sf} onChange={(e) => onChange({ sf: Number(e.target.value) })}>
                {SF_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    SF{v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Bandwidth">
            {(id) => (
              <select id={id} value={s.bwKhz} onChange={(e) => onChange({ bwKhz: Number(e.target.value) })}>
                {BW_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} kHz
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}

      {s.presetId === 'custom' ? (
        <Field label="Frequency">{(id) => <NumberField id={id} value={s.freqMhz} min={150} max={1000} step={0.001} decimals={3} unit="MHz" onChange={(freqMhz) => onChange({ freqMhz })} />}</Field>
      ) : (
        !preset?.freqMhz && (
          <Field label="Band" hint="Propagation changes very little across a band, so the band centre is used.">
            {(id) => (
              <select id={id} value={s.bandId} onChange={(e) => onChange({ bandId: e.target.value })}>
                {BANDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )
      )}

      <div className="readout" aria-live="polite">
        SF{radio.sf} · {radio.bwKhz} kHz · {freq} MHz · sensitivity ≈ {fmt(loraSensitivityDbm(radio.sf, radio.bwKhz))} dBm
      </div>

      <div className="row">
        <Field label="Transmit power">{(id) => <NumberField id={id} value={s.txPowerDbm} min={0} max={36} step={1} unit="dBm" onChange={(txPowerDbm) => onChange({ txPowerDbm })} />}</Field>
        <Field label="Antenna gain">{(id) => <NumberField id={id} value={s.txGainDbi} min={-10} max={25} step={0.1} decimals={1} unit="dBi" onChange={(txGainDbi) => onChange({ txGainDbi })} />}</Field>
      </div>
      <div className="row">
        <Field label="Cable &amp; connector loss">{(id) => <NumberField id={id} value={s.txCableLossDb} min={0} max={20} step={0.1} decimals={1} unit="dB" onChange={(txCableLossDb) => onChange({ txCableLossDb })} />}</Field>
        <Field label="Height above ground">{(id) => <NumberField id={id} value={s.hTxM} min={1} max={300} step={0.5} decimals={1} unit="m" onChange={(hTxM) => onChange({ hTxM })} />}</Field>
      </div>
      <div className="readout">
        Radiated power (EIRP) ≈ {fmt(eirp)} dBm. Check your region's legal limit for this band.
      </div>

      <details className="subsection">
        <summary>The receiving device</summary>
        <p className="note">Coverage shows where a device like this could hear your node.</p>
        <div className="row">
          <Field label="Height above ground">{(id) => <NumberField id={id} value={s.hRxM} min={0.5} max={100} step={0.5} decimals={1} unit="m" onChange={(hRxM) => onChange({ hRxM })} />}</Field>
          <Field label="Antenna gain">{(id) => <NumberField id={id} value={s.rxGainDbi} min={-10} max={25} step={0.1} decimals={1} unit="dBi" onChange={(rxGainDbi) => onChange({ rxGainDbi })} />}</Field>
        </div>
        <div className="row">
          <Field label="Cable loss">{(id) => <NumberField id={id} value={s.rxCableLossDb} min={0} max={20} step={0.1} decimals={1} unit="dB" onChange={(rxCableLossDb) => onChange({ rxCableLossDb })} />}</Field>
          <Field label="Extra loss allowance" hint="Foliage, buildings, enclosures — things the model can't see. Your own estimate.">
            {(id) => <NumberField id={id} value={s.extraLossDb} min={0} max={60} step={1} unit="dB" onChange={(extraLossDb) => onChange({ extraLossDb })} />}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.sensitivityOverride !== null} onChange={(e) => onChange({ sensitivityOverride: e.target.checked ? Math.round(sensitivity) : null })} /> Set receiver sensitivity manually
        </label>
        {s.sensitivityOverride !== null && (
          <Field label="Receiver sensitivity">
            {(id) => <NumberField id={id} value={s.sensitivityOverride as number} min={-160} max={-60} step={0.5} decimals={1} unit="dBm" onChange={(sensitivityOverride) => onChange({ sensitivityOverride })} />}
          </Field>
        )}
      </details>
    </Section>
  )
}
