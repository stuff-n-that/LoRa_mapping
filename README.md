# LoRa Mesh Map

A mobile- and desktop-friendly web map for plotting **MeshCore** and **Meshtastic** LoRa mesh network nodes, with switchable base maps and toggleable overlays.

## Features

- **Base layers**: OpenStreetMap (streets), Esri World Imagery (satellite), OpenTopoMap (terrain) — switch via the layers control (top right).
- **Overlays**: MeshCore nodes and Meshtastic nodes, independently toggleable on/off via the same control.
- **Add nodes**: tap "+ Add node", then tap the map to place a pin and fill in name, network, hardware, and notes.
- **Import/export**: back up or share your node list as JSON (`Export`), or load one (`Import`). Data persists locally in the browser (`localStorage`).
- **Live data**: toggle "MeshCore" / "Meshtastic" in the Live data panel to overlay real node positions from public community maps, auto-refreshed every 5 minutes (see [Live data feeds](#live-data-feeds) below). Live nodes get a dashed marker border and aren't editable/deletable — they just refresh. On GitHub Pages this currently errors (CORS — see below); a periodically-refreshed snapshot is shown automatically instead, when one has been embedded in the build.
- **Mobile friendly**: full-height responsive layout, touch-sized controls, works on phones, tablets, and desktop.
- **Clustered markers**: MeshCore and Meshtastic overlays cluster nearby nodes into a bubble showing the count, expanding as you zoom in (`disableClusteringAtZoom={14}`). Real data from the two networks combined is 80,000+ nodes — this isn't optional polish, it's what keeps the map from hanging or crashing at that scale, especially on mobile.

Ships with a small set of clearly-labelled sample nodes so the map isn't empty on first load — replace them via `Import`, the `+ Add node` button, or `Reset sample data`.

## Development

```bash
npm install
npm run dev       # local dev server
npm run build     # production build to dist/
npm run preview   # preview the production build
```

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys `dist/` to GitHub Pages on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**. The site will be served at `/LoRa_mapping/`, matching the `base` path in `vite.config.js`.

## Data model

Each node is a plain object:

```json
{
  "id": "unique-id",
  "name": "My node",
  "network": "meshcore | meshtastic",
  "lat": 51.5074,
  "lng": -0.1278,
  "hardware": "Heltec V3",
  "notes": "optional notes",
  "lastSeen": "optional timestamp"
}
```

## Live data feeds

Manual/imported nodes and live nodes are merged on the map but kept separate: live nodes are fetched client-side, never written to `localStorage` or included in `Export`, and simply disappear if you turn their toggle off.

**MeshCore** (`src/api/meshcoreLive.js`) fetches directly from `map.meshcore.dev`, the backend behind the official [MeshCore Map](https://meshcore.co.uk/map.html) (source: [meshcore-dev/map.meshcore.io](https://github.com/meshcore-dev/map.meshcore.io)). The response is MessagePack with abbreviated field names (`?binary=1&short=1`), decoded client-side with `msgpackr` and re-inflated to full field names, mirroring the official frontend's own logic.

**Meshtastic** (`src/api/meshtasticLive.js`) fetches from the public community instance at `meshtastic.liamcottle.net`, built on [liamcottle/meshtastic-map](https://github.com/liamcottle/meshtastic-map) (an Express + Prisma server fed by the public `mqtt.meshtastic.org` broker). Its `/api/v1/nodes` endpoint is documented in that repo's source.

**Both fail from the deployed GitHub Pages site in practice** — confirmed in production, not just theorized. The official `map.meshcore.io` frontend fetching cross-origin from `map.meshcore.dev` only proves CORS is open *for that specific origin*, not for arbitrary third-party sites like a GitHub Pages deployment; Meshtastic's API was always the more clearly at-risk one since it serves its own frontend same-origin. Both APIs most likely allow only their own known frontend origin, not ours. The panel shows a clear error rather than crashing — that graceful-degradation path works as intended — but real live data doesn't currently reach the deployed static site this way.

**`npm run pull-live-nodes`** (`scripts/pull-live-nodes.mjs`) calls the same `fetchMeshcoreNodes`/`fetchMeshtasticNodes` functions from Node instead of a browser, so CORS doesn't apply, and writes `{ generatedAt, nodes }` to `live-nodes-snapshot.json` (or another path you pass as an argument). Load that file with the map's `Import` button for a real, manually-triggered snapshot.

Both integrations were built by reading the linked open-source frontends' code rather than from official public API docs (neither project publishes one), so field names or response shapes may drift if those projects change. If a live feed breaks, check the linked source repos for what changed.

**Both APIs return full node history, not just currently-active nodes.** A real pull on 2026-09-22 came back with 63,658 MeshCore + 17,973 Meshtastic nodes. `src/api/activeNode.js` filters both sources to nodes with a last-seen/last-advert timestamp within the past 7 days (`fetchMeshcoreNodes`/`fetchMeshtasticNodes` apply this themselves, so it affects the interactive Live data toggles too, not just the CI snapshot) — that took MeshCore to 25,034 and barely touched Meshtastic (17,980). `pull-live-nodes.mjs` also has a `MAX_NODES_PER_NETWORK` safety backstop, but it's set high (30,000) specifically so it doesn't act as a realistic limiter: an earlier, lower cap (5,000, picking the *globally* most-recently-active nodes before slicing) silently gutted whole dense regions that just happened to have slightly older timestamps than nodes elsewhere, confirmed by comparing against meshcore.co.uk's own map for the same area — a real bug, not just a smaller sample. If the payload ever needs trimming again, prefer widening/narrowing `ACTIVE_WINDOW_MS` (uniform everywhere) over lowering this cap (geographically arbitrary).

### Automatic snapshot on GitHub Pages

`.github/workflows/deploy.yml` runs `pull-live-nodes.mjs` before every build (`continue-on-error`, so a down API doesn't block a deploy) and writes it to `public/live-nodes-snapshot.json` — Vite copies anything in `public/` verbatim into `dist/`, so it ships as a static file at the site root. The frontend fetches it once on load (`App.jsx`) and merges it into the map as `source: 'snapshot'` nodes (same dashed-border treatment as live nodes, distinct popup text, not persisted or exported). The workflow also runs on a 30-minute `schedule`, independent of code changes, purely to refresh this file and redeploy.

This means the GitHub Pages site shows real (if up to 30 minutes stale) node positions automatically, without the browser ever hitting the upstream APIs directly — the fetch happens once, in CI, on GitHub's own infrastructure. It's a middle ground between "fully live" (blocked by CORS on Pages) and "static seed data": not real-time, but not manual either.

### Running as a local server (real live data, no CORS issue)

`server/index.js` is a minimal Node server (built-ins only, no framework) that serves the built frontend *and* proxies both live-data APIs itself. Since the fetch to `map.meshcore.dev`/`meshtastic.liamcottle.net` happens server-side, CORS doesn't apply — the browser only ever talks to this server, same-origin.

```bash
npm run build:server   # builds the frontend with VITE_LIVE_PROXY=true and a root ('/') base path
npm run server          # serves dist/ plus /api/live-nodes/{meshcore,meshtastic}
# or just: npm start    # does both
```

Then open `http://localhost:5175` (override with `PORT=1234 npm run server`). The server lazily refreshes each source's cache at most every 5 minutes — only on request, so an idle server does no polling — and keeps serving the last-known nodes alongside any new error rather than blanking the map on a transient upstream failure.

This is a separate build target from `npm run build` (GitHub Pages): that one bakes in the `/LoRa_mapping/` base path and talks to the upstream APIs directly from the browser (works only if/when those APIs allow the Pages origin — see above). Don't serve a `build:server` output from GitHub Pages or vice versa; the base paths and live-data wiring are incompatible.

Other sites from the original brief — [MeshCore Coverage](https://meshcore.co.uk/coverage.html), [NoDakMesh](https://nodakmesh.org/meshcore/map), [Meshtastic Map (friendlydev)](https://meshtastic-map.friendlydev.com/), [MeshMap.net](https://meshmap.net/) — were not wired up. `friendlydev` and NoDakMesh appear to aggregate from the same underlying sources already included; MeshMap.net's documented API (`docs.meshmap.com`) requires an API key/JWT rather than being open for anonymous cross-site fetches, and the coverage layer (predicted RF coverage, not live nodes) would be a separate, larger effort. Adding any of these later means finding their actual data endpoint (usually only discoverable from source, not docs) and adding a new file under `src/api/` following the same pattern.
