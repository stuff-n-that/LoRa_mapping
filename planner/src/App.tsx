import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASEMAPS, type BasemapId } from './basemaps'
import ExistingNetworks from './components/ExistingNetworks'
import MapView, { type MapViewTarget } from './components/MapView'
import NodeForm from './components/NodeForm'
import ResultPanel, { Legend, type DisplayOptions, type RunStatus } from './components/ResultPanel'
import { sampleResult, type CoverageResult } from './engine/coverage'
import { haversineM, type LatLng } from './engine/geo'
import { runCoverage } from './engine/run'
import { useExistingNodes, useOverlay } from './hooks'
import { ROLE_CATEGORIES } from './nodes'
import { DEFAULTS, effectiveSensitivityDbm, jobKey, parseSettings, toHash, toJob, type Settings } from './settings'

const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => parseSettings(window.location.hash))
  const [basemap, setBasemap] = useState<BasemapId>('streets')
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null)
  const [show, setShow] = useState({ meshcore: true, meshtastic: true })
  const [roles, setRoles] = useState(() => new Set(ROLE_CATEGORIES.map((c) => c.key)))
  const [run, setRun] = useState<RunStatus>({ status: 'idle' })
  const [result, setResult] = useState<CoverageResult | null>(null)
  const [display, setDisplay] = useState<DisplayOptions>({ opacity: 0.7, minMargin: 0, mode: 'smooth' })
  const [panelOpen, setPanelOpen] = useState(true)
  const [target, setTarget] = useState<MapViewTarget | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const targetId = useRef(0)
  const fitted = useRef(false)

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), [])

  // ---- URL hash: the whole scenario is shareable -------------------------------------------
  // Pasting a shared link into a tab that already has the planner open only changes the hash,
  // with no reload, so follow it. (Our own history.replaceState below does not fire this event.)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    const onHashChange = () => {
      const incoming = window.location.hash.replace(/^#/, '')
      if (incoming === toHash(settingsRef.current)) return
      const next = parseSettings(incoming)
      setSettings(next)
      if (next.node) setTarget({ id: ++targetId.current, center: next.node, zoom: 11 })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      const h = toHash(settings)
      window.history.replaceState(null, '', h ? `#${h}` : window.location.pathname + window.location.search)
    }, 250)
    return () => clearTimeout(t)
  }, [settings])

  // ---- existing nodes ---------------------------------------------------------------------------
  const existing = useExistingNodes(settings.regions)
  const shownNodes = useMemo(
    () => existing.nodes.filter((n) => show[n.network] && roles.has(n.roleCategory)),
    [existing.nodes, show, roles],
  )

  // Frame the first batch of loaded nodes unless a node (and so a view) was already chosen.
  useEffect(() => {
    if (fitted.current || settings.node || existing.nodes.length === 0) return
    fitted.current = true
    let [w, s, e, n] = [180, 90, -180, -90]
    for (const nd of existing.nodes) {
      w = Math.min(w, nd.lng)
      e = Math.max(e, nd.lng)
      s = Math.min(s, nd.lat)
      n = Math.max(n, nd.lat)
    }
    setTarget({ id: ++targetId.current, bounds: [[w, s], [e, n]] })
  }, [existing.nodes, settings.node])

  // ---- coverage -----------------------------------------------------------------------------------
  const sensitivity = effectiveSensitivityDbm(settings)
  const overlay = useOverlay(result, sensitivity, display.minMargin, display.mode)

  const currentKey = useMemo(() => {
    try {
      return jobKey(toJob(settings))
    } catch {
      return null
    }
  }, [settings])
  const stale = !!result && currentKey !== jobKey(result.job)

  const calculate = useCallback(async () => {
    let job
    try {
      job = toJob(settings)
    } catch (err) {
      setRun({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRun({ status: 'running', phase: 'terrain', fraction: 0 })
    try {
      const r = await runCoverage(job, {
        signal: ac.signal,
        onProgress: (phase, fraction) => setRun({ status: 'running', phase, fraction }),
      })
      if (ac.signal.aborted) return
      setResult(r)
      setRun({ status: 'idle' })
    } catch (err) {
      if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        setRun({ status: 'idle' })
        return
      }
      setRun({ status: 'error', message: `Couldn't calculate coverage: ${err instanceof Error ? err.message : String(err)}` })
    }
  }, [settings])

  const cancel = useCallback(() => abortRef.current?.abort(), [])
  useEffect(() => () => abortRef.current?.abort(), [])

  // ---- map interactions ---------------------------------------------------------------------------
  const place = useCallback(
    (ll: LatLng) => {
      patch({ node: ll })
      setTarget({ id: ++targetId.current, center: ll, zoom: 11 })
    },
    [patch],
  )

  const inspect = useCallback(
    (ll: LatLng): string | null => {
      if (!result || !settings.node) return null
      const d = fmtKm(haversineM(settings.node, ll))
      const prx = sampleResult(result, ll.lat, ll.lng)
      if (Number.isNaN(prx)) return `${d} from the node — outside the calculated area`
      const margin = prx - sensitivity
      const sign = margin >= 0 ? '+' : ''
      return `${prx.toFixed(0)} dBm · ${sign}${margin.toFixed(0)} dB margin · ${d} from the node${margin < 0 ? ' (below sensitivity)' : ''}`
    },
    [result, settings.node, sensitivity],
  )

  const useMyLocation = useCallback(() => {
    setLocationError(null)
    if (!navigator.geolocation) {
      setLocationError("Your browser can't share its location here.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        place({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        setLocating(false)
        setLocationError(err.code === err.PERMISSION_DENIED ? 'Location permission was declined.' : "Couldn't get your location.")
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    )
  }, [place])

  const share = useCallback(async () => {
    const h = toHash(settings)
    window.history.replaceState(null, '', h ? `#${h}` : window.location.pathname)
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareState('copied')
    } catch {
      setShareState('failed')
    }
    setTimeout(() => setShareState('idle'), 2500)
  }, [settings])

  const homeHref = '../'
  const mapHref = `../map/${settings.regions.length ? '' : ''}`

  return (
    <div className={`app${panelOpen ? '' : ' panel-closed'}`}>
      <header className="topbar">
        <a className="brand" href={homeHref} aria-label="LoRa Mesh Map home">
          LoRa Planner <span className="beta">beta</span>
        </a>
        <nav aria-label="Site">
          <a href={mapHref}>Live map</a>
          <a href={homeHref}>About</a>
        </nav>
      </header>

      <aside className="sidebar" aria-label="Planner controls">
        <button type="button" className="sheet-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          {panelOpen ? 'Hide controls ▾' : 'Show controls ▴'}
        </button>
        <div className="sidebar-scroll">
          <ExistingNetworks
            state={existing}
            selected={settings.regions}
            onSelectedChange={(regions) => patch({ regions })}
            show={show}
            onShowChange={setShow}
            roles={roles}
            onRolesChange={setRoles}
            shownCount={shownNodes.length}
          />
          <NodeForm
            settings={settings}
            onChange={patch}
            onClearNode={() => patch({ node: null })}
            onUseLocation={useMyLocation}
            locating={locating}
            locationError={locationError}
          />
          <ResultPanel
            settings={settings}
            onChange={patch}
            run={run}
            result={result}
            stale={stale}
            onCalculate={calculate}
            onCancel={cancel}
            display={display}
            onDisplayChange={setDisplay}
            onShare={share}
            shareState={shareState}
          />
          <p className="footnote">
            Terrain: AWS Terrain Tiles (SRTM, EU-DEM, GMTED2010, 3DEP and others). Propagation: NTIA Irregular Terrain Model. Everything is calculated in your browser, and
            the settings you enter are never sent to us. Map and terrain tiles come from public servers, which can see roughly which area you are viewing.
          </p>
        </div>
      </aside>

      <main className="stage">
        <MapView
          basemap={basemap}
          onBasemapUnavailable={() => {
            setBasemap('relief')
            setBasemapNotice('The street map could not be reached, so shaded relief is shown instead.')
          }}
          nodes={shownNodes}
          planned={settings.node}
          onPlace={place}
          onMovePlanned={(ll) => patch({ node: ll })}
          overlay={overlay}
          overlayOpacity={display.opacity}
          inspect={inspect}
          onPlanHere={place}
          target={target}
          layoutKey={String(panelOpen)}
        />
        <div className="basemap-switch" role="radiogroup" aria-label="Base map">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={basemap === b.id}
              className={basemap === b.id ? 'on' : ''}
              onClick={() => {
                setBasemapNotice(null)
                setBasemap(b.id)
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        {basemapNotice && (
          <div className="map-notice" role="status">
            <span>{basemapNotice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setBasemapNotice(null)}>
              ×
            </button>
          </div>
        )}
        {result && overlay && <Legend minMargin={display.minMargin} />}
        {!settings.node && existing.nodes.length === 0 && (
          <div className="map-hint">Click the map to place the node you want to plan.</div>
        )}
      </main>
    </div>
  )
}

// Keep the defaults reachable from the console when debugging a shared link.
;(window as unknown as { __plannerDefaults?: Settings }).__plannerDefaults = DEFAULTS
