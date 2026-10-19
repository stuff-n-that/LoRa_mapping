import { BANDS, RADIO_PRESETS, eirpDbm, loraSensitivityDbm } from '../engine/radio'
import { activeQuickStart, QUICK_STARTS } from '../quickStarts'
import { MAX_NAME_LENGTH, effectiveFreqMhz, effectiveRadio, presetFor, type Network, type PlannedNode } from '../settings'
import { Field, NumberField, Segmented } from './ui'

interface Props {
  node: PlannedNode
  onChange: (patch: Partial<PlannedNode>) => void
}

const SF_OPTIONS = [5, 6, 7, 8, 9, 10, 11, 12]
const BW_OPTIONS = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

const fmt = (n: number) => n.toFixed(1)

/** The settings of one node: name, position, radio and hardware. */
export default function NodeForm({ node: n, onChange }: Props) {
  const preset = presetFor(n.presetId)
  const radio = effectiveRadio(n)
  const freq = effectiveFreqMhz(n)
  const eirp = eirpDbm(n)
  const presets = RADIO_PRESETS.filter((p) => p.network === n.network)
  const active = activeQuickStart(n)

  const setNetwork = (network: Network) => {
    const first = RADIO_PRESETS.find((p) => p.network === network)
    onChange({ network, presetId: first ? first.id : 'custom' })
  }

  return (
    <div className="node-form">
      <Field label="Name">
        {(id) => <input id={id} type="text" value={n.name} maxLength={MAX_NAME_LENGTH} onChange={(e) => onChange({ name: e.target.value })} onBlur={(e) => !e.target.value.trim() && onChange({ name: 'Node' })} />}
      </Field>

      <div className="field">
        <span className="label">Location</span>
        <div className="row">
          <NumberField value={n.position.lat} min={-85} max={85} step={0.00001} decimals={5} onChange={(lat) => onChange({ position: { lat, lng: n.position.lng } })} unit="lat" />
          <NumberField value={n.position.lng} min={-180} max={180} step={0.00001} decimals={5} onChange={(lng) => onChange({ position: { lat: n.position.lat, lng } })} unit="lng" />
        </div>
        <div className="hint">Drag its pin on the map to move it.</div>
      </div>

      <div className="field">
        <span className="label">Network</span>
        <Segmented
          label="Network"
          value={n.network}
          onChange={setNetwork}
          options={[
            { id: 'meshtastic', label: 'Meshtastic' },
            { id: 'meshcore', label: 'MeshCore' },
          ]}
        />
      </div>

      <Field label="Radio settings" hint={preset?.note}>
        {(id) => (
          <select id={id} value={n.presetId} onChange={(e) => onChange({ presetId: e.target.value })}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom (spreading factor / bandwidth)</option>
          </select>
        )}
      </Field>
      {preset && <div className="hint">Where these numbers come from: {preset.source}</div>}

      {n.presetId === 'custom' && (
        <div className="row">
          <Field label="Spreading factor">
            {(id) => (
              <select id={id} value={n.sf} onChange={(e) => onChange({ sf: Number(e.target.value) })}>
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
              <select id={id} value={n.bwKhz} onChange={(e) => onChange({ bwKhz: Number(e.target.value) })}>
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

      {n.presetId === 'custom' ? (
        <Field label="Frequency">{(id) => <NumberField id={id} value={n.freqMhz} min={150} max={1000} step={0.001} decimals={3} unit="MHz" onChange={(freqMhz) => onChange({ freqMhz })} />}</Field>
      ) : (
        !preset?.freqMhz && (
          <Field label="Band" hint="Propagation changes very little across a band, so the band centre is used.">
            {(id) => (
              <select id={id} value={n.bandId} onChange={(e) => onChange({ bandId: e.target.value })}>
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

      <div className="field">
        <span className="label">Quick start</span>
        <div className="quick" role="group" aria-label="Quick start">
          {QUICK_STARTS.map((q) => (
            <button
              key={q.id}
              type="button"
              className={`btn small${active?.id === q.id ? ' on' : ''}`}
              aria-pressed={active?.id === q.id}
              title={q.hint}
              onClick={() => onChange(q.patch)}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="hint">Fills in the four boxes below with typical values; change any of them to suit your own gear.</div>
      </div>

      <div className="row">
        <Field label="Transmit power">{(id) => <NumberField id={id} value={n.txPowerDbm} min={0} max={36} step={1} unit="dBm" onChange={(txPowerDbm) => onChange({ txPowerDbm })} />}</Field>
        <Field label="Antenna gain">{(id) => <NumberField id={id} value={n.txGainDbi} min={-10} max={25} step={0.1} decimals={1} unit="dBi" onChange={(txGainDbi) => onChange({ txGainDbi })} />}</Field>
      </div>
      <div className="row">
        <Field label="Cable &amp; connector loss">{(id) => <NumberField id={id} value={n.txCableLossDb} min={0} max={20} step={0.1} decimals={1} unit="dB" onChange={(txCableLossDb) => onChange({ txCableLossDb })} />}</Field>
        <Field label="Height above ground">{(id) => <NumberField id={id} value={n.hTxM} min={1} max={300} step={0.5} decimals={1} unit="m" onChange={(hTxM) => onChange({ hTxM })} />}</Field>
      </div>
      <div className="readout">Radiated power (EIRP) ≈ {fmt(eirp)} dBm. Check your region's legal limit for this band.</div>
    </div>
  )
}
