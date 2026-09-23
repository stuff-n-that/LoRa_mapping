import { useEffect, useMemo, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'

export default function RegionPicker({ onNodesLoaded }) {
  const [regions, setRegions] = useState([])
  const [indexStatus, setIndexStatus] = useState('loading') // loading | ready | missing
  const [search, setSearch] = useState('')
  const [selectedCodes, setSelectedCodes] = useState([])
  const [regionData, setRegionData] = useState({}) // code -> { status, nodes, error }

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

  // Re-merge and notify the parent whenever the selection or any region's
  // data changes. Nodes can never collide across countries (each is
  // assigned to at most one), so a plain concat is safe.
  useEffect(() => {
    const merged = selectedCodes.flatMap((code) => regionData[code]?.nodes || [])
    onNodesLoaded(merged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCodes, regionData])

  function loadRegion(code) {
    setRegionData((prev) => ({ ...prev, [code]: { status: 'loading', nodes: [] } }))
    fetch(`${import.meta.env.BASE_URL}regions/${code}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`responded ${res.status}`)
        return res.json()
      })
      .then((data) => {
        const nodes = (data.nodes || []).map((n) => ({ ...n, id: `snapshot-${n.id}`, source: 'snapshot' }))
        setRegionData((prev) => ({ ...prev, [code]: { status: 'ready', nodes } }))
      })
      .catch((err) => {
        setRegionData((prev) => ({ ...prev, [code]: { status: 'error', nodes: [], error: err.message } }))
      })
  }

  function toggleRegion(code) {
    setSelectedCodes((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code)
      if (!regionData[code]) loadRegion(code)
      return [...prev, code]
    })
  }

  const filteredRegions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return regions
    return regions.filter((r) => r.name.toLowerCase().includes(q))
  }, [regions, search])

  const totalNodes = selectedCodes.reduce((sum, code) => sum + (regionData[code]?.nodes.length || 0), 0)
  const summary =
    selectedCodes.length > 0 ? `${selectedCodes.length} selected · ${totalNodes.toLocaleString()} nodes` : 'none selected'

  if (indexStatus === 'missing') return null // no CI-generated regions available (e.g. local dev)

  return (
    <CollapsibleSection title="Node data region" summary={summary} className="region-panel">
      {selectedCodes.length > 0 && (
        <div className="region-chips">
          {selectedCodes.map((code) => {
            const region = regions.find((r) => r.code === code)
            const data = regionData[code]
            return (
              <span key={code} className="region-chip">
                {region?.name || code}
                {data?.status === 'loading' && '…'}
                {data?.status === 'error' && ' ⚠'}
                <button type="button" onClick={() => toggleRegion(code)} aria-label={`Remove ${region?.name || code}`}>
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}

      <input
        type="text"
        className="region-search"
        placeholder="Search countries…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="region-list">
        {indexStatus === 'loading' && <p className="region-status">Loading regions…</p>}
        {filteredRegions.map((r) => (
          <label key={r.code} className="region-list-item">
            <input type="checkbox" checked={selectedCodes.includes(r.code)} onChange={() => toggleRegion(r.code)} />
            <span>{r.name}</span>
            <span className="region-list-count">{r.count.toLocaleString()}</span>
          </label>
        ))}
        {indexStatus === 'ready' && filteredRegions.length === 0 && (
          <p className="region-status">No countries match "{search}"</p>
        )}
      </div>

      <p className="region-panel-note">
        Select multiple countries to see cross-border data together — data loads per country and stays until you remove it.
        Refreshed periodically via CI.
      </p>
    </CollapsibleSection>
  )
}
