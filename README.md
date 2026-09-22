# LoRa Mesh Map

A mobile- and desktop-friendly web map for plotting **MeshCore** and **Meshtastic** LoRa mesh network nodes, with switchable base maps and toggleable overlays.

## Features

- **Base layers**: OpenStreetMap (streets), Esri World Imagery (satellite), OpenTopoMap (terrain) — switch via the layers control (top right).
- **Overlays**: MeshCore nodes and Meshtastic nodes, independently toggleable on/off via the same control.
- **Add nodes**: tap "+ Add node", then tap the map to place a pin and fill in name, network, hardware, and notes.
- **Import/export**: back up or share your node list as JSON (`Export`), or load one (`Import`). Data persists locally in the browser (`localStorage`).
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

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys `dist/` to GitHub Pages on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**. The site will be served at `/lora_mapping/`, matching the `base` path in `vite.config.js`.

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

## Future work: live data feeds

Node data currently lives client-side (seed JSON + `localStorage`, import/export). To pull live positions instead of manual entry, the natural next step is a small backend/proxy that fetches from public mesh mapping sources and serves normalized JSON to the frontend, e.g.:

- [MeshCore Map](https://meshcore.co.uk/map.html) / [MeshCore Coverage](https://meshcore.co.uk/coverage.html)
- [NoDakMesh MeshCore Map](https://nodakmesh.org/meshcore/map)
- [Meshtastic Map (friendlydev)](https://meshtastic-map.friendlydev.com/)
- [MeshMap.net](https://meshmap.net/)
- [Liam Cottle's Meshtastic Map](https://meshtastic.liamcottle.net/)

Each of these has its own data source/API shape, so this would need separate research and likely a CORS-friendly proxy (most won't allow direct browser fetches), plus a refresh/polling strategy and a way to merge live nodes with manually-added ones.
