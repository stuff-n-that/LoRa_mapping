# LoRa Mesh Map

A mobile- and desktop-friendly web map for plotting **MeshCore** and **Meshtastic** LoRa mesh network nodes, with switchable base maps and toggleable overlays.

## Features

- **Base layers**: OpenStreetMap (streets), Esri World Imagery (satellite), OpenTopoMap (terrain) — switch via the layers control (top right).
- **Overlays**: MeshCore nodes and Meshtastic nodes, independently toggleable on/off via the same control.
- **Add nodes**: tap "+ Add node", then tap the map to place a pin and fill in name, network, hardware, and notes.
- **Import/export**: back up or share your node list as JSON (`Export`), or load one (`Import`). Data persists locally in the browser (`localStorage`).
- **Live data**: toggle "MeshCore" / "Meshtastic" in the Live data panel to overlay real node positions from public community maps, auto-refreshed every 5 minutes (see [Live data feeds](#live-data-feeds) below). Live nodes get a dashed marker border and aren't editable/deletable — they just refresh.
- **Mobile friendly**: full-height responsive layout, touch-sized controls, works on phones, tablets, and desktop.

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

**MeshCore** (`src/api/meshcoreLive.js`) fetches directly from `map.meshcore.dev`, the backend behind the official [MeshCore Map](https://meshcore.co.uk/map.html) (source: [meshcore-dev/map.meshcore.io](https://github.com/meshcore-dev/map.meshcore.io)). That frontend runs on a *different* origin (`map.meshcore.io`) and fetches from `map.meshcore.dev`, which is what proves the endpoint already sends CORS headers for cross-site browser requests — no proxy needed. The response is MessagePack with abbreviated field names (`?binary=1&short=1`), decoded client-side with `msgpackr` and re-inflated to full field names, mirroring the official frontend's own logic.

**Meshtastic** (`src/api/meshtasticLive.js`) fetches from the public community instance at `meshtastic.liamcottle.net`, built on [liamcottle/meshtastic-map](https://github.com/liamcottle/meshtastic-map) (an Express + Prisma server fed by the public `mqtt.meshtastic.org` broker). Its `/api/v1/nodes` endpoint is documented in that repo's source, but — unlike MeshCore's — it serves its own frontend from the *same* origin, so there's no proof it sends CORS headers for other sites. If it's blocked, the panel just shows an error and manual/MeshCore data keeps working; this is the graceful-degradation path, not a bug.

Both integrations were built by reading the linked open-source frontends' code rather than from official public API docs (neither project publishes one), so field names or response shapes may drift if those projects change. If a live feed breaks, check the linked source repos for what changed.

Other sites from the original brief — [MeshCore Coverage](https://meshcore.co.uk/coverage.html), [NoDakMesh](https://nodakmesh.org/meshcore/map), [Meshtastic Map (friendlydev)](https://meshtastic-map.friendlydev.com/), [MeshMap.net](https://meshmap.net/) — were not wired up. `friendlydev` and NoDakMesh appear to aggregate from the same underlying sources already included; MeshMap.net's documented API (`docs.meshmap.com`) requires an API key/JWT rather than being open for anonymous cross-site fetches, and the coverage layer (predicted RF coverage, not live nodes) would be a separate, larger effort. Adding any of these later means finding their actual data endpoint (usually only discoverable from source, not docs) and adding a new file under `src/api/` following the same pattern.
