import { useState } from 'react'

export default function AddNodeModal({ latlng, onCancel, onSave }) {
  const [name, setName] = useState('')
  const [network, setNetwork] = useState('meshtastic')
  const [hardware, setHardware] = useState('')
  const [notes, setNotes] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    onSave({ name, network, hardware, notes, lat: latlng.lat, lng: latlng.lng })
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Add node</h2>
        <p className="modal-coords">
          {latlng.lat.toFixed(5)}, {latlng.lng.toFixed(5)}
        </p>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="e.g. Home base" />
        </label>

        <label>
          Network
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="meshtastic">Meshtastic</option>
            <option value="meshcore">MeshCore</option>
          </select>
        </label>

        <label>
          Hardware (optional)
          <input value={hardware} onChange={(e) => setHardware(e.target.value)} placeholder="e.g. Heltec V3" />
        </label>

        <label>
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Save node
          </button>
        </div>
      </form>
    </div>
  )
}
