# LoRa Planner

A free, in-browser coverage planner for MeshCore and Meshtastic nodes. Place a node, choose radio settings, antenna and mast height, and see predicted coverage over real terrain, alongside the existing nodes of both networks. Published at `/plan/` next to the live map (`/map/`) and the landing page (`/`).

Spec and roadmap: [`docs/PLANNER-SPEC.md`](../docs/PLANNER-SPEC.md). This folder is **M0 + M1** of that plan.

## What it does today

- Existing MeshCore and Meshtastic nodes by country (the same snapshots the map uses), with the network toggle and role filter.
- **A network of up to 10 planned nodes.** Add nodes by clicking the map ("+ Add node", Esc cancels), from your location, or from an existing node's popup; numbered pins can be dragged, and clicking a pin or a card selects it. Each node has its own name, location, network (so MeshCore and Meshtastic can be mixed), radio preset or custom SF/bandwidth, band, transmit power, antenna gain, cable loss and mast height. A new node starts with the selected node's settings. The receiving device (height, gain, extra loss allowance, sensitivity) and the range/detail/reliability/climate/ground choices are shared by every node.
- Coverage over real terrain out to 5–50 km at three detail levels, typical or cautious planning, in seconds.
- **Combined coverage.** The map shows, at every point, the strongest margin of any node (each node judged against its own network's sensitivity). "Show" switches to a single node, each node's own area appears on its card, and the readout when you click the map lists what every node predicts there, best first.
- Heatmap (smooth or banded) with legend, adjustable opacity and minimum margin — these re-render instantly without recalculating.
- Click the map to read the predicted signal at any point; click the readout to dismiss it, or click elsewhere to read another spot.
- A **Topo** basemap (elevation tint, hillshade, contour lines with elevation labels) drawn in the browser from the same terrain tiles, so it needs no extra service and doubles as the fallback when the street map can't be loaded. It has no road or place names; use Streets for those.
- Everything in the URL hash: shareable links, and "Plan coverage from here" from the live map.

## Develop

```bash
cd planner
npm install
npm run dev          # http://localhost:5173
npm test             # engine, geometry, terrain, settings, rendering
npm run typecheck
npm run build        # production build to dist/ (base /LoRa_mapping/plan/)
```

The planner reads node data from `../map/regions/` (published by the map's deploy). In dev, `vite` serves a local copy at that URL from `../public/regions/` (what `npm run pull-live-nodes public/regions` writes in the repo root), or from `REGIONS_DIR=/some/folder npm run dev`. Without it the planner works; it just shows no existing nodes.

## How coverage is computed

1. **Terrain.** AWS Terrain Tiles ("Terrarium" PNGs; free, no key, cross-origin) covering the chosen range are downloaded and decoded in the browser. A failed download is an error, never silently flat ground. Heights below sea level are treated as sea level.
2. **Local elevation grid.** The tiles are resampled into a square grid centred on the node in an azimuthal-equidistant projection, in which every great circle through the node is a straight line and distances from it are exact.
3. **Profiles and loss.** For every pixel of the output raster, a terrain profile from the node is read from that grid and passed to the Longley-Rice / ITM point-to-point model (`src/engine/itm.ts`), giving the basic transmission loss.
4. **Link budget.** Received power = EIRP + receive gain − cable losses − extra loss allowance − path loss. The map shows *margin*: received power minus the receiver's sensitivity (from the radio preset, or entered).
5. **Parallelism.** Rows are split across Web Workers (interleaved for load balance); each builds its own copy of the grid, so no shared memory or special server headers are needed.
6. **Several nodes.** Every node is computed onto one shared raster that covers all their discs (so results line up pixel for pixel), one node after another, each spread across the worker pool; each node only computes the rows its own disc touches, and terrain tiles shared between nodes are downloaded once. Results are kept per node as received power, so changing sensitivity, the view or the colours re-renders without recalculating. When nodes are far apart the pixels get coarser (the raster is capped at 1024 × 1024), and plans spanning more than about 500 km are refused.

A 20 km run at normal detail takes about a second on a laptop; 50 km at fine detail about ten.

### Cautious planning

ITM's *time* variability is small (under 2 dB across 10–99%); its *situation* variability (confidence) is about ±9 dB. "Cautious (90%)" therefore applies 90% to both, which costs roughly 10 dB of path loss at distance.

### What it does not model

Buildings, trees and other clutter (use the extra loss allowance), weather, interference, antenna radiation patterns beyond a single gain figure, and receiver/transmitter tolerances. Results are estimates; the UI says so.

## The ITM port and how it is verified

`src/engine/itm.ts` is a TypeScript port of NTIA's reference implementation (<https://github.com/NTIA/itm>), point-to-point mode only. NTIA's software is a US-government work released for any use with acknowledgement and a note of modifications; see [`NOTICE.md`](NOTICE.md).

`test/itm.test.ts` checks the port against values produced by **running NTIA's original C++** on 225 paths: NTIA's own five published vectors plus synthetic terrain covering line-of-sight, diffraction and troposcatter and every variability mode. The port agrees to about 5e-11 dB. Mutating a single constant in the port fails dozens of cases.

To regenerate the fixtures (needs `g++`, `python3` and a checkout of NTIA's repo):

```bash
git clone https://github.com/NTIA/itm /tmp/itm
python3 test/itm-reference/generate.py /tmp/itm
```

## Clean-room note

The planner was designed from the public feature descriptions of two existing tools, [Meshtastic Site Planner](https://github.com/meshtastic/meshtastic-site-planner) (GPL-3.0) and [Mesh Community Planner](https://github.com/PapaSierra555/MeshCommunityPlanner) (CC BY-NC-SA 4.0). **No code from either was used**, and contributors should not copy code from them. The propagation model comes from NTIA, not from SPLAT!.

## Layout

```
src/engine/    itm.ts (NTIA port) · terrain.ts · coverage.ts · coverage.worker.ts · run.ts · radio.ts · geo.ts
src/           settings.ts (state + URL hash) · render.ts · nodes.ts · hooks.ts · basemaps.ts · App.tsx
src/components MapView (MapLibre) · NodeForm · ExistingNetworks · ResultPanel · ui
test/          unit tests; fixtures/itm-golden.json; itm-reference/ (generator for the fixtures)
```

`@shared/…` imports pure modules from the live map (`../src/utils`), so role categories cannot drift apart.

## Known gaps

- The street basemap (OpenFreeMap) could not be reached from the sandbox this was built in, so it was only verified to fail over cleanly to the Topo map; check it on the deployed site. Node-count labels on clusters use its font server too.
- Satellite imagery (Esri) likewise needs a check on the deployed site.
- Radio presets: Meshtastic's LongFast and the other 250 kHz presets and MeshCore's US/Canada setting are confirmed from public docs; LongModerate/LongSlow were not confirmed, so use custom SF/bandwidth for those. MeshCore has no official source for its presets; the UI says so.
- No vector contours yet (banded colours instead), no relay-chain or link analysis between your nodes, no "where should the next node go?" help, and no hardware catalogue — see the spec's M2–M5. Changing any setting recalculates every node, since they share one raster.
