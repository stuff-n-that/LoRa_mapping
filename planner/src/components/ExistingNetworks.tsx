import { useMemo, useState } from 'react'
import { ROLE_CATEGORIES } from '../nodes'
import type { ExistingNodesState } from '../hooks'
import { Section } from './ui'

interface Props {
  state: ExistingNodesState
  selected: string[]
  onSelectedChange: (codes: string[]) => void
  show: { meshcore: boolean; meshtastic: boolean }
  onShowChange: (s: { meshcore: boolean; meshtastic: boolean }) => void
  roles: Set<string>
  onRolesChange: (r: Set<string>) => void
  shownCount: number
}

export default function ExistingNetworks({ state, selected, onSelectedChange, show, onShowChange, roles, onRolesChange, shownCount }: Props) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.index
      .filter((r) => !selected.includes(r.code) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase() === q))
      .slice(0, 8)
  }, [state.index, selected, query])
  const nameOf = (code: string) => state.index.find((r) => r.code === code)?.name ?? code

  const summary = selected.length ? `${shownCount.toLocaleString()} nodes shown` : 'pick a country'

  return (
    <Section title="Existing networks" summary={summary} defaultOpen={selected.length === 0}>
      <div className="chips">
        <label className="chip">
          <input type="checkbox" checked={show.meshcore} onChange={(e) => onShowChange({ ...show, meshcore: e.target.checked })} />
          <span className="dot meshcore" /> MeshCore
        </label>
        <label className="chip">
          <input type="checkbox" checked={show.meshtastic} onChange={(e) => onShowChange({ ...show, meshtastic: e.target.checked })} />
          <span className="dot meshtastic" /> Meshtastic
        </label>
      </div>

      {state.indexStatus === 'unavailable' ? (
        <p className="note">Country node data isn't available here. It is published alongside the main map.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="region-search">Show nodes from</label>
            <input
              id="region-search"
              type="search"
              placeholder={state.indexStatus === 'loading' ? 'Loading countries…' : 'Search countries'}
              value={query}
              disabled={state.indexStatus !== 'ready'}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          {query.trim() && (
            <ul className="results" aria-label="Matching countries">
              {matches.length === 0 && <li className="note">No match</li>}
              {matches.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectedChange([...selected, r.code])
                      setQuery('')
                    }}
                  >
                    {r.name} <span className="count">{r.count.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {selected.length > 0 && (
        <div className="chips" aria-live="polite">
          {selected.map((code) => (
            <span key={code} className="tag">
              {nameOf(code)}
              {state.loading.includes(code) && ' …'}
              {state.failed[code] && ' ⚠'}
              <button type="button" aria-label={`Remove ${nameOf(code)}`} onClick={() => onSelectedChange(selected.filter((c) => c !== code))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {Object.entries(state.failed).map(([code, msg]) => (
        <p className="note warn" key={code}>
          Couldn't load {nameOf(code)}: {msg}
        </p>
      ))}

      <details className="subsection">
        <summary>Filter by device role</summary>
        <div className="checks">
          {ROLE_CATEGORIES.map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={roles.has(c.key)}
                onChange={(e) => {
                  const next = new Set(roles)
                  if (e.target.checked) next.add(c.key)
                  else next.delete(c.key)
                  onRolesChange(next)
                }}
              />{' '}
              {c.label}
            </label>
          ))}
        </div>
      </details>
    </Section>
  )
}
