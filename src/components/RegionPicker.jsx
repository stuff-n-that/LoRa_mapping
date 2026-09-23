import { useEffect, useState } from 'react'
import { formatAgo } from '../utils/format'

export default function RegionPicker({ onNodesLoaded }) {
  const [regions, setRegions] = useState([])
  const [indexStatus, setIndexStatus] = useState('loading') // loading | ready | missing
  const [selectedCode, setSelectedCode] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null) // { code, name, generatedAt, count }

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}regions/index.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.regions) {
          setIndexStatus('missing')
          return
        }
        setRegions(data.regions)
        setIndexStatus('ready')
      })
      .catch(() => setIndexStatus('missing'))
  }, [])

  function handleChange(e) {
    const code = e.target.value
    setSelectedCode(code)

    if (!code) {
      setStatus('idle')
      setMeta(null)
      onNodesLoaded([], null)
      return
    }

    const region = regions.find((r) => r.code === code)
    setStatus('loading')
    setError('')

    fetch(`${import.meta.env.BASE_URL}regions/${code}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`responded ${res.status}`)
        return res.json()
      })
      .then((data) => {
        const nodes = (data.nodes || []).map((n) => ({ ...n, id: `snapshot-${n.id}`, source: 'snapshot' }))
        setStatus('ready')
        setMeta({ code, name: region?.name || code, generatedAt: data.generatedAt, count: nodes.length })
        onNodesLoaded(nodes, { code, name: region?.name || code, generatedAt: data.generatedAt })
      })
      .catch((err) => {
        setStatus('error')
        setError(err.message)
        onNodesLoaded([], null)
      })
  }

  if (indexStatus === 'missing') return null // no CI-generated regions available (e.g. local dev)

  return (
    <div className="region-panel">
      <div className="region-panel-title">Node data region</div>
      <select
        className="region-select"
        value={selectedCode}
        onChange={handleChange}
        disabled={indexStatus === 'loading'}
      >
        <option value="">
          {indexStatus === 'loading' ? 'Loading regions…' : 'Select a country…'}
        </option>
        {regions.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} ({r.count.toLocaleString()})
          </option>
        ))}
      </select>
      {status === 'loading' && <p className="region-status">Loading…</p>}
      {status === 'error' && <p className="region-status region-status-error">Failed to load: {error}</p>}
      {status === 'ready' && meta && (
        <p className="region-status">
          {meta.count.toLocaleString()} nodes in {meta.name} · fetched {formatAgo(meta.generatedAt)}
        </p>
      )}
      <p className="region-panel-note">
        Loads real node data for one country at a time (replacing the last selection) to keep this fast on mobile.
        Refreshed periodically via CI.
      </p>
    </div>
  )
}
