# LoRa Mesh Map

A mobile- and desktop-friendly web map for plotting **MeshCore** and **Meshtastic** LoRa mesh network nodes, with switchable base maps and toggleable overlays.

## Site structure

The deployed site has two parts, assembled together by the deploy workflow:

- **`landing/`** — a static, framework-free landing page (`index.html` + `favicon.svg`) served at the site root. No build step: it's plain HTML/CSS with a tiny vanilla-JS progressive enhancement (live node/country counts) and a `FAQPage` JSON-LD block for search/AI answer-engine visibility. Kept deliberately separate from the React app so it's fully crawlable without JS execution.
- **The React map app** (everything else in `src/`) — served under `/map/`.

Locally, `npm run dev` only serves the React app (at `/`, not `/map/`) — the landing page isn't part of the Vite project and has no dev server of its own; open `landing/index.html` directly, or preview the real assembled layout per [Deployment](#deployment) below.

## Features

- **Map layers panel**: base map (OpenStreetMap streets, Esri World Imagery satellite, OpenTopoMap terrain) and the MeshCore/Meshtastic overlays, each independently toggleable — styled to match the rest of the panel stack rather than Leaflet's default layers control.
- **Region picker**: the "Node data region" panel loads real, per-country node data from a periodically-refreshed CI snapshot. Search to filter the country list, and select as many as you want — e.g. neighbouring countries to see cross-border coverage — data stays loaded until you remove it. See [Live data feeds](#live-data-feeds).
- **Node type filter**: the "Node type" panel filters by device role — Repeater/Router, Client, Sensor/Tracker, Room Server, Other/Unknown — pick as many as you want. It's one shared filter across both networks: MeshCore's node type and Meshtastic's device role are two different enums from two unrelated projects, normalized into this one set (`src/utils/nodeRoles.js`) so there's a single control instead of two. Only applies to MeshCore/Meshtastic region data; sample nodes have no role to filter on, so they're always shown. Any role value that doesn't map to a known category (missing, or from a future firmware version neither map knows about yet) falls into "Other/Unknown" rather than being silently dropped — that bucket is on by default.
- **Collapsible panels**: the Node data region and Node type panels both start collapsed (a one-line header with a live summary, e.g. "2 selected · 4,301 nodes") so they don't take over the screen on mobile — tap to expand. Loaded data stays active even while collapsed.
- **Mobile friendly**: full-height responsive layout, touch-sized controls, works on phones, tablets, and desktop.
- **Clustered markers**: MeshCore and Meshtastic overlays cluster nearby nodes into a bubble showing the count, expanding as you zoom in (`disableClusteringAtZoom={14}`). Real data from the two networks combined is 80,000+ nodes — this isn't optional polish, it's what keeps the map from hanging or crashing at that scale, especially on mobile.

Ships with a small set of clearly-labelled sample nodes so the map isn't empty on first load — each can be removed via its popup's "Delete node" button. There's no add/import/export/reset UI; the map is read-only aside from that.

## Development

```bash
npm install
npm run dev       # local dev server
npm run build     # production build to dist/
npm run preview   # preview the production build
```

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**.

The workflow builds the React app (`npm run build` → `dist/`, with `vite.config.js`'s `base` set to `/LoRa_mapping/map/`) and assembles a combined `site/` directory before uploading it as the Pages artifact: `landing/`'s contents at `site/`'s root, and `dist/`'s contents under `site/map/`. So the deployed layout is `/LoRa_mapping/` → landing page, `/LoRa_mapping/map/` → the map app. To preview that exact layout locally: `npm run build && mkdir -p site/map && cp -r landing/. site/ && cp -r dist/. site/map/`, then serve `site/` with any static file server.

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

Real node data never reaches the browser by a direct, interactive API call — there's no client-side live-data toggle. Instead, `src/api/meshcoreLive.js` and `src/api/meshtasticLive.js` are called **server-side**, by the scripts below, and the results ship to the frontend as static per-country JSON that the Region picker loads on demand.

**MeshCore** (`src/api/meshcoreLive.js`) fetches directly from `map.meshcore.dev`, the backend behind the official [MeshCore Map](https://meshcore.co.uk/map.html) (source: [meshcore-dev/map.meshcore.io](https://github.com/meshcore-dev/map.meshcore.io)). The response is MessagePack with abbreviated field names (`?binary=1&short=1`), decoded with `msgpackr` and re-inflated to full field names, mirroring the official frontend's own logic.

**Meshtastic** (`src/api/meshtasticLive.js`) fetches from the public community instance at `meshtastic.liamcottle.net`, built on [liamcottle/meshtastic-map](https://github.com/liamcottle/meshtastic-map) (an Express + Prisma server fed by the public `mqtt.meshtastic.org` broker). Its `/api/v1/nodes` endpoint is documented in that repo's source.

**Both fail if called from the browser on the deployed GitHub Pages site** — confirmed in production, not just theorized — which is exactly why these run server-side (in CI, see below) rather than as a direct toggle. The official `map.meshcore.io` frontend fetching cross-origin from `map.meshcore.dev` only proves CORS is open *for that specific origin*, not for arbitrary third-party sites like a GitHub Pages deployment; Meshtastic's API was always the more clearly at-risk one since it serves its own frontend same-origin. Both APIs most likely allow only their own known frontend origin, not ours.

Both integrations were built by reading the linked open-source frontends' code rather than from official public API docs (neither project publishes one), so field names or response shapes may drift if those projects change. If a live feed breaks, check the linked source repos for what changed.

### Sharded by country, not filtered by time

Both APIs return full node history, not just currently-active nodes — a real pull came back with 63,658 MeshCore + 17,973 Meshtastic nodes globally. Two earlier approaches to keeping that manageable were both wrong in ways only visible once compared against the official MeshCore map for the same area:

- Filtering to nodes seen in the last 7 days cut the total a lot, but there's no evidence the official map filters by recency at all — it likely just shows everything registered, so a time filter alone will always undercount versus it.
- Capping to a fixed number of "most recently active" nodes globally is worse: sorting by timestamp with no regard for location can (and did) gut an entire dense region just because nodes elsewhere happened to have marginally newer timestamps, while leaving other regions untouched. Confirmed directly: the official map showed 175/108/306+ node clusters in Northern Europe where this app showed 3/4/18, for the same MeshCore layer.

**`scripts/pull-live-nodes.mjs`** now fetches everything from both APIs, unfiltered, and shards it by country instead: `scripts/lib/countryLookup.mjs` assigns each node's lat/lng to a country using real boundary polygons (`world-atlas`'s 1:110m Natural Earth data + a standard ray-casting point-in-polygon test, not bounding boxes), and the script writes one file per country (`<output-dir>/<ISO-alpha-2>.json`, shape `{ generatedAt, country: { code, name }, nodes }`) plus an `index.json` listing every country that has data (`{ code, name, count }`). No node is ever dropped for being old or for losing an arbitrary global sort — the only way a node doesn't appear is if its coordinates don't resolve to any country (open ocean, mostly).

```bash
npm run pull-live-nodes              # writes to public/regions/ by default
node scripts/pull-live-nodes.mjs some/other/dir
```

### Region picker + automatic refresh on GitHub Pages

The "Node data region" panel (`src/components/RegionPicker.jsx`) fetches `regions/index.json` once on load to populate a searchable, multi-select country list, then fetches each country's file only when you check it — already-loaded countries stay cached, so re-checking one doesn't refetch it, and unchecking one just removes it from the merged set. This is what actually keeps the page fast: the browser only ever downloads and parses the countries you actually selected, not a global blob, so there's no time-based filtering or count-based capping needed to keep it usable — and you can select multiple neighbouring countries at once to see cross-border coverage.

`.github/workflows/deploy.yml` runs `pull-live-nodes.mjs` before every build (`continue-on-error`, so a down API doesn't block a deploy of actual code changes) and writes to `public/regions/` — Vite copies anything in `public/` verbatim into `dist/`, so it ships as static files at the site root. The workflow also runs on a 30-minute `schedule`, independent of code changes, purely to refresh this data and redeploy. So the GitHub Pages site has real (if up to 30 minutes stale) per-country node data available on demand, without the browser ever hitting the upstream APIs directly — the fetch happens once, in CI, on GitHub's own infrastructure.

### Ground-truth check against your own hardware (Meshtastic, work in progress)

If you have a real Meshtastic node, `scripts/pull-local-node.mjs` reads its local node database directly (via `scripts/local-node/read_meshtastic_nodes.py`, using the standard `meshtastic` Python library — needs `pip install meshtastic` — over USB serial or your node's local Wi-Fi API) and compares the neighbours it hears **directly** (`hopsAway === 0`) against what the public community map claims for those same node IDs. Every directly-heard neighbour is reported as one of:

- **matches the public map** at a plausible distance,
- **not on the public map at all** (not necessarily wrong — they may not have opted into public reporting), or
- **implausible distance** — the public map places them farther away than a single real-world LoRa hop plausibly reaches (`src/utils/checkPlausibility.js`, a haversine distance check against a generous, tunable cutoff — plain math, not an AI judgement call).

```bash
npm run pull-local-node -- --lat <your latitude> --lng <your longitude>                 # USB serial, auto-detect
npm run pull-local-node -- --lat <your latitude> --lng <your longitude> --host 192.168.1.50   # Wi-Fi node
```

The data-shape logic (`src/api/meshtasticLocal.js`'s `normalizeLocalNodes`, and the plausibility check itself) is unit-verified against synthetic data mimicking `meshtastic-python`'s well-established `Interface.nodes` shape. **The device connection itself is not yet smoke-tested against real hardware** — there's no Meshtastic node reachable from this environment to test against, so expect to debug field names against whatever `meshtastic-python` version you actually install. Not yet wired into the map UI (no `source: 'local'` marker styling or on-screen toggle) — this is CLI-only for now, a starting point for when real hardware is available to validate and finish the UI against. MeshCore's equivalent isn't started: its local/companion protocol needs checking against the actual firmware source once real hardware is available, unlike Meshtastic's which is well-documented.

Other sites from the original brief — [MeshCore Coverage](https://meshcore.co.uk/coverage.html), [NoDakMesh](https://nodakmesh.org/meshcore/map), [Meshtastic Map (friendlydev)](https://meshtastic-map.friendlydev.com/), [MeshMap.net](https://meshmap.net/) — were not wired up. `friendlydev` and NoDakMesh appear to aggregate from the same underlying sources already included; MeshMap.net's documented API (`docs.meshmap.com`) requires an API key/JWT rather than being open for anonymous cross-site fetches, and the coverage layer (predicted RF coverage, not live nodes) would be a separate, larger effort. Adding any of these later means finding their actual data endpoint (usually only discoverable from source, not docs) and adding a new file under `src/api/` following the same pattern.
