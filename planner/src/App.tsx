import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASEMAPS, type BasemapId } from './basemaps'
import ExistingNetworks from './components/ExistingNetworks'
import LinkPanel from './components/LinkPanel'
import LinkSetup from './components/LinkSetup'
import MapView, { type LinkOnMap, type MapViewTarget, type PlannedPin } from './components/MapView'
import NodeList from './components/NodeList'
import ResultPanel, { Legend, type DisplayOptions, type RunStatus } from './components/ResultPanel'
import type { LatLng } from './engine/geo'
import { pointAlongPath } from './engine/link'
import { runNetwork } from './engine/run'
import { contourLines } from './contours'
import { useExistingNodes, useLinkAnalysis, useOverlay } from './hooks'
import { buildLinkPlan } from './linkModel'
import { MARGIN_BANDS } from './render'
import { combineMargins, readingsAt, summarizeMargins, type NetworkResult } from './network'
import { ROLE_CATEGORIES } from './nodes'
import {
  DEFAULTS,
  MAX_NODES,
  effectiveSensitivityDbm,
  jobKey,
  newNode,
  parseSettings,
  planKey,
  toHash,
  toJobs,
  type PlannedNode,
  type Settings,
} from './settings'

const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}`

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => parseSettings(window.location.hash))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const [basemap, setBasemap] = useState<BasemapId>('streets')
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null)
  const [show, setShow] = useState({ meshcore: true, meshtastic: true })
  const [roles, setRoles] = useState(() => new Set(ROLE_CATEGORIES.map((c) => c.key)))
  const [run, setRun] = useState<RunStatus>({ status: 'idle' })
  const [network, setNetwork] = useState<NetworkResult | null>(null)
  const [display, setDisplay] = useState<DisplayOptions>({ opacity: 0.7, minMargin: 0, mode: 'smooth', view: 'all', contours: false, hover: true })
  const [panelOpen, setPanelOpen] = useState(true)
  const [linkCursor, setLinkCursor] = useState<number | null>(null)
  const [target, setTarget] = useState<MapViewTarget | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const targetId = useRef(0)
  const fitted = useRef(false)

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), [])
  const patchNode = useCallback(
    (id: string, p: Partial<PlannedNode>) => setSettings((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) })),
    [],
  )

  // The selected node, falling back to the first if it was removed (or none was chosen yet).
  const selected = settings.nodes.find((n) => n.id === selectedId) ?? settings.nodes[0] ?? null

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
      setSelectedId(null)
      setPlacing(false)
      setLinkCursor(null)
      if (next.nodes[0]) setTarget({ id: ++targetId.current, center: next.nodes[0].position, zoom: 11 })
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
  const shownExisting = useMemo(
    () => existing.nodes.filter((n) => show[n.network] && roles.has(n.roleCategory)),
    [existing.nodes, show, roles],
  )

  // Frame the first batch of loaded nodes unless a node (and so a view) was already chosen.
  useEffect(() => {
    if (fitted.current || settings.nodes.length > 0 || existing.nodes.length === 0) return
    fitted.current = true
    let [w, s, e, n] = [180, 90, -180, -90]
    for (const nd of existing.nodes) {
      w = Math.min(w, nd.lng)
      e = Math.max(e, nd.lng)
      s = Math.min(s, nd.lat)
      n = Math.max(n, nd.lat)
    }
    setTarget({ id: ++targetId.current, bounds: [[w, s], [e, n]] })
  }, [existing.nodes, settings.nodes.length])

  // ---- adding, selecting and removing nodes -----------------------------------------------------
  const addNode = useCallback((position: LatLng, opts: { fly?: boolean } = {}) => {
    const current = settingsRef.current
    if (current.nodes.length >= MAX_NODES) return
    const template = current.nodes.find((n) => n.id === selectedId) ?? current.nodes[current.nodes.length - 1]
    const node = newNode(current.nodes, position, template)
    setSettings((s) => (s.nodes.length >= MAX_NODES ? s : { ...s, nodes: [...s.nodes, node] }))
    setSelectedId(node.id)
    setPlacing(false)
    if (opts.fly || current.nodes.length === 0) setTarget({ id: ++targetId.current, center: position, zoom: 11 })
  }, [selectedId])

  const removeNode = useCallback((id: string) => {
    // Ids are reused, so once nothing is left drop the old result rather than let a new "Node 1" inherit it.
    if (settingsRef.current.nodes.every((n) => n.id === id)) setNetwork(null)
    setSettings((s) => ({
      ...s,
      nodes: s.nodes.filter((n) => n.id !== id),
      // a link that ended at this node has nothing left to analyse
      link: s.link && (s.link.from === id || (s.link.to.kind === 'node' && s.link.to.id === id)) ? null : s.link,
    }))
    setSelectedId((cur) => (cur === id ? null : cur))
  }, [])

  // Esc cancels "click the map to place the next node".
  useEffect(() => {
    if (!placing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing])

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
        addNode({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { fly: true })
      },
      (err) => {
        setLocating(false)
        setLocationError(err.code === err.PERMISSION_DENIED ? 'Location permission was declined.' : "Couldn't get your location.")
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    )
  }, [addNode])

  // ---- coverage -----------------------------------------------------------------------------------
  const sensitivity = useMemo(() => {
    const out: Record<string, number> = {}
    for (const n of settings.nodes) out[n.id] = effectiveSensitivityDbm(n, settings)
    return out
  }, [settings])

  // Results for nodes still in the plan, narrowed to one node if the user chose that view.
  const view = display.view !== 'all' && settings.nodes.some((n) => n.id === display.view) ? display.view : 'all'
  const shown = useMemo(
    () => (network ? network.nodes.filter((n) => settings.nodes.some((x) => x.id === n.id) && (view === 'all' || n.id === view)) : []),
    [network, settings.nodes, view],
  )
  const geom = network?.nodes[0]?.result.geom ?? null
  const margins = useMemo(
    () => (geom && shown.length ? combineMargins(shown.map((n) => ({ data: n.result.data, sensitivityDbm: sensitivity[n.id] })), geom.n * geom.n) : null),
    [geom, shown, sensitivity],
  )
  const overlay = useOverlay(geom, margins, display.minMargin, display.mode)

  // Each node's own coverage area, shown on its card.
  const areas = useMemo(() => {
    const out: Record<string, number | undefined> = {}
    if (!network) return out
    for (const n of network.nodes) {
      if (!settings.nodes.some((x) => x.id === n.id)) continue
      const m = combineMargins([{ data: n.result.data, sensitivityDbm: sensitivity[n.id] }], n.result.geom.n ** 2)
      out[n.id] = summarizeMargins(m, n.result.geom, display.minMargin).areaKm2
    }
    return out
  }, [network, settings.nodes, sensitivity, display.minMargin])

  // Signal lines at the edges of the colour bands.
  const signalLines = useMemo(
    () => (display.contours && geom && margins ? contourLines(geom, margins, MARGIN_BANDS.map((b) => b.from).filter((l) => l >= display.minMargin)) : null),
    [display.contours, geom, margins, display.minMargin],
  )

  // ---- the link being analysed ----------------------------------------------------------------
  const linkBuilt = useMemo(() => (settings.link ? buildLinkPlan(settings) : null), [settings])
  const linkPlan = linkBuilt?.ok ? linkBuilt.plan : null
  const linkWaiting = linkBuilt && !linkBuilt.ok ? linkBuilt.reason : null
  const linkState = useLinkAnalysis(linkPlan)
  const linkOpen = !!settings.link
  const pickingTarget = linkWaiting === 'pick-target'
  const setLinkTarget = useCallback(
    (position: LatLng) =>
      setSettings((s) => (s.link && s.link.to.kind === 'point' ? { ...s, link: { ...s.link, to: { ...s.link.to, position } } } : s)),
    [],
  )
  const linkOnMap: LinkOnMap | null = useMemo(() => {
    if (!linkPlan) return null
    const analysis = linkState.status === 'ready' ? linkState.analysis : null
    const np = analysis ? analysis.path.distKm.length - 1 : 0
    const along = (i: number) => pointAlongPath(linkPlan.a.position, linkPlan.b.position, i / np)
    return {
      a: linkPlan.a.position,
      b: linkPlan.b.position,
      bIsTarget: !linkPlan.bIsNode,
      verdict: analysis ? analysis.assessment.verdict : null,
      cursor: analysis && linkCursor !== null && linkCursor <= np ? along(linkCursor) : null,
      obstruction: analysis && !analysis.path.losClear ? along(analysis.path.blockingIndex) : null,
    }
  }, [linkPlan, linkState, linkCursor])
  useEffect(() => setLinkCursor(null), [settings.link])
  const setLink = useCallback(
    (link: Settings['link']) => {
      patch({ link })
      // frame the link when it is first opened between two nodes
      if (link?.to.kind === 'node') {
        const toId = link.to.id
        const a = settingsRef.current.nodes.find((n) => n.id === link.from)
        const b = settingsRef.current.nodes.find((n) => n.id === toId)
        if (a && b)
          setTarget({
            id: ++targetId.current,
            bounds: [
              [Math.min(a.position.lng, b.position.lng), Math.min(a.position.lat, b.position.lat)],
              [Math.max(a.position.lng, b.position.lng), Math.max(a.position.lat, b.position.lat)],
            ],
          })
      }
    },
    [patch],
  )

  const currentKey = useMemo(() => planKey(settings), [settings])
  const stale = !!network && currentKey !== network.nodes.map((n) => `${n.id}:${n.key}`).join('|')

  const calculate = useCallback(async () => {
    let jobs
    try {
      jobs = toJobs(settings)
    } catch (err) {
      setRun({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    const nodes = settings.nodes
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRun({ status: 'running', phase: 'terrain', fraction: 0, node: 1, count: jobs.length })
    const t0 = performance.now()
    try {
      const results = await runNetwork(jobs, {
        signal: ac.signal,
        onProgress: (p) => setRun({ status: 'running', phase: p.phase, fraction: p.overall, node: p.index + 1, count: p.count }),
      })
      if (ac.signal.aborted) return
      setNetwork({
        nodes: nodes.map((n, i) => ({ id: n.id, name: n.name, key: jobKey(jobs[i]), result: results[i] })),
        elapsedMs: performance.now() - t0,
      })
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
  const inspect = useCallback(
    (ll: LatLng): string[] | null => {
      if (!network || shown.length === 0) return null
      const sources = shown.flatMap((n) => {
        const node = settings.nodes.find((x) => x.id === n.id)
        return node ? [{ name: node.name, position: node.position, result: n.result, sensitivityDbm: sensitivity[n.id] }] : []
      })
      const readings = readingsAt(sources, ll)
      if (readings.length === 0) return ['Outside the calculated area']
      const best = readings[0]
      const from = sources.length === 1 ? 'the node' : best.name
      const lines = [`${best.prxDbm.toFixed(0)} dBm · ${signed(best.marginDb)} dB margin · ${fmtKm(best.distanceM)} from ${from}${best.marginDb < 0 ? ' (below sensitivity)' : ''}`]
      for (const r of readings.slice(1, 5)) lines.push(`${r.name}: ${signed(r.marginDb)} dB · ${fmtKm(r.distanceM)}`)
      return lines
    },
    [network, shown, settings.nodes, sensitivity],
  )

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

  const pins: PlannedPin[] = useMemo(() => settings.nodes.map((n, i) => ({ id: n.id, position: n.position, label: i + 1 })), [settings.nodes])
  const homeHref = '../'
  const mapHref = '../map/'
  const nextNodeName = `Node ${settings.nodes.length + 1}`

  return (
    <div className={`app${panelOpen ? '' : ' panel-closed'}${linkOpen ? ' link-open' : ''}`}>
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
            shownCount={shownExisting.length}
          />
          <NodeList
            nodes={settings.nodes}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onRemove={removeNode}
            onChange={patchNode}
            onAdd={() => setPlacing(true)}
            placing={placing}
            onCancelPlacing={() => setPlacing(false)}
            onUseLocation={useMyLocation}
            locating={locating}
            locationError={locationError}
            areas={areas}
          />
          <LinkSetup nodes={settings.nodes} link={settings.link} defaultFromId={selected?.id ?? null} defaultTargetHeightM={settings.hRxM} onChange={setLink} />
          <ResultPanel
            settings={settings}
            onChange={patch}
            run={run}
            network={network}
            shown={shown}
            sensitivity={sensitivity}
            defaultSensitivity={selected ? effectiveSensitivityDbm(selected, { sensitivityOverride: null }) : null}
            margins={margins}
            geom={geom}
            stale={stale}
            onCalculate={calculate}
            onCancel={cancel}
            display={{ ...display, view }}
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
            setBasemap('topo')
            setBasemapNotice('The street map could not be reached, so the topographic map is shown instead.')
          }}
          nodes={shownExisting}
          planned={pins}
          selectedId={selected?.id ?? null}
          onSelectNode={setSelectedId}
          onMoveNode={(id, ll) => patchNode(id, { position: ll })}
          placing={placing}
          onPlace={(ll) => addNode(ll)}
          overlay={overlay}
          overlayOpacity={display.opacity}
          inspect={inspect}
          onPlanHere={(ll) => addNode(ll)}
          target={target}
          layoutKey={`${panelOpen}${linkOpen}`}
          link={linkOnMap}
          pickingTarget={pickingTarget}
          onPickTarget={setLinkTarget}
          onMoveTarget={setLinkTarget}
          signalLines={signalLines}
          hover={display.hover}
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
        {network && overlay && <Legend minMargin={display.minMargin} />}
        {pickingTarget && (
          <div className="map-hint placing-banner" role="status">
            <span>Click the map to place the other end of the link</span>
            <button type="button" className="btn small" onClick={() => setLink(null)}>
              Cancel
            </button>
          </div>
        )}
        {placing && (
          <div className="map-hint placing-banner" role="status">
            <span>Click the map to place {nextNodeName}</span>
            <button type="button" className="btn small" onClick={() => setPlacing(false)}>
              Cancel
            </button>
          </div>
        )}
        {!placing && settings.nodes.length === 0 && existing.nodes.length === 0 && <div className="map-hint">Click the map to place the node you want to plan.</div>}
      </main>

      {linkOpen && <LinkPanel plan={linkPlan} waiting={linkWaiting} state={linkState} cursor={linkCursor} onCursor={setLinkCursor} onClose={() => setLink(null)} />}
    </div>
  )
}

// Keep the defaults reachable from the console when debugging a shared link.
;(window as unknown as { __plannerDefaults?: Settings }).__plannerDefaults = DEFAULTS
