# Planner — product & feature spec

Status: **M0 and M1 are built** (see [`planner/`](../planner/README.md)); M2 onwards is not started. Decisions taken while building are recorded under "Decisions so far" at the end.

A separate area of the site, linked from the landing page and from the main map, for **planning a LoRa mesh deployment in one place**: pick a network (MeshCore or Meshtastic, or compare both), see what already exists around you, predict coverage and links with real terrain, choose hardware, and walk away with a shopping list.

## Why this exists

Planning a deployment today means stitching together several tools that don't know about each other:

- MeshCore and Meshtastic node data live in different places.
- The planning tools are hard to discover, and each covers only part of the job (see "What the two reference tools teach us").
- Researching hardware (device, antenna, cable, power) is a separate, tiring exercise.

The goal is one place that answers: *"What's already near me, what could I reach from here, which network suits this location, and what do I buy?"*

## Principles

1. **One place, both networks.** A network toggle (MeshCore / Meshtastic / both), the same way the main map already works. Plans can mix them.
2. **Free to run, free to use.** Static hosting, all computation in the user's browser, no accounts, no backend in v1. Hosting cost should stay at or near zero.
3. **Easy first.** A first-time user gets a useful coverage map in a few clicks with sensible defaults; detail is opt-in.
4. **Honest about uncertainty.** Predictions are models. Every result is labelled as an estimate and says what it does not account for.
5. **Honest about money.** Hardware links may earn a commission. Disclosure is always visible, and recommendations never depend on commission (see "Hardware & affiliate links").
6. **Privacy by default.** Plans live in the browser and in shareable links the user chooses to create. No analytics on plan contents.

## Clean-room rules

This spec was written from the public READMEs, architecture notes and feature lists of two existing open projects, used purely to understand *what a planning tool should do*:

- Meshtastic Site Planner (GPL-3.0)
- Mesh Community Planner (CC BY-NC-SA 4.0 — non-commercial)

**No source code from either project may be copied, translated or closely paraphrased into this one**, and implementers should not work with either project's code open alongside this one. Ideas, workflows and the underlying physics are not copyrightable; their code is, and the two licences cannot be combined with each other or with a project that wants to stay free to relicense. The same applies to the SPLAT! code the first project builds on (GPL).

The propagation model itself (ITM / Longley-Rice) is published science. The engine in this project must come from a **permissively licensed or public-domain ITM implementation, or be written from the published algorithm description** — the licence of whichever source is chosen must be verified and recorded before adoption (see "Open questions").

## What the two reference tools teach us

| Need | What a good planner does (observed from the reference tools' documentation) |
|---|---|
| Works with no install, no server cost | Run the propagation model in the browser (WebAssembly in worker threads), fetch free public terrain tiles, cache them locally. |
| Fast to explore | Compute once, then change colours / range / sensitivity without recomputing. |
| Readable results | A heatmap *and* crisp contour bands that can be tapped for a signal level. |
| Shareable | Parameters live in the URL, so a link reproduces the scenario. |
| A real plan, not one transmitter | Many nodes in one project, with per-node device, radio, antenna, cable and power settings. |
| Know your link | Terrain profile between two points, with Fresnel-zone clearance and a link margin. |
| Know your network | Topology view, critical-node detection, simple resilience metrics. |
| Know your limits | Airtime / capacity estimates, regulatory presets per region. |
| Turn the plan into purchases | A bill of materials with exports. |
| Start from what exists | Importing live node positions from the networks' public maps. |

Neither tool combines all of these, and neither starts from a map that already shows both networks' real nodes. That is the gap.

## Where it lives

- **Separate area**, its own app: `planner/` in this repository, built to `/plan/` on the site (next to the landing page at `/` and the map at `/map/`).
- **Entry points:** a clear link in the landing-page navigation and hero area, and a link/button in the main map's toolbar. From a map selection or a node popup, "Plan from here" opens the planner centred on that location.
- **Shared data:** the planner reads the same per-country node snapshots the map already uses (published under `/map/regions/`), the same role normalisation (Repeater/Router, Client, Sensor/Tracker, Room Server, Other), and the same MeshCore/Meshtastic toggle behaviour. Shared pure code (data shapes, role mapping) may be factored out; UI is separate.
- **Same stack family** as the main app where it helps (TypeScript or JavaScript, Vite), but the planner is a separate bundle so the lightweight map stays lightweight. The map renderer is a decision for the planner alone (see "Open questions").

## Core concepts

- **Plan** — a named project: a list of nodes, a region/band, optional notes. Saved in the browser; exportable and importable as a file; shareable as a link for small plans.
- **Node** — a planned or existing station: position, network (MeshCore / Meshtastic), device, radio preset, antenna (type, gain), cable (type, length), mounting height, power source. Existing nodes (from live data) are read-only references; planned nodes are editable.
- **Scenario** — what we are evaluating: a coverage run for one or more nodes, or a link between two points.
- **Result** — an estimate with its inputs, assumptions and caveats attached, so it can be reproduced and exported.

## Feature list, by milestone

Each milestone should be usable on its own and shippable.

### M0 — Shell and entry points
- `planner/` app skeleton, built into the site alongside the landing page and map.
- Links from the landing page and the main map. "Plan from here" hand-off with a location.
- Map showing existing MeshCore and Meshtastic nodes with the familiar network toggle, region picker and role filter.
- Mobile-friendly layout from day one.

### M1 — One node, real coverage (the "wow, that was easy" milestone)
- Drop a node on the map; pick network, device, radio preset, antenna and height from short lists with defaults. Defaults produce a sensible result without touching anything.
- Coverage prediction using real terrain, run in the browser, with progress and cancel.
- Heatmap display (smooth or banded colours — vector contours come later); tap to read a signal level; legend; adjustable sensitivity and colour range that re-render instantly.
- Receiver sensitivity derived from the chosen radio preset rather than a single hard-coded value.
- Permalink that reproduces the scenario.
- A clearly visible "what this does not model" note (buildings, foliage, weather, interference unless explicitly added).

### M2 — Links, and "which network is better here?"
- **Point-to-point link:** terrain profile, line of sight, Fresnel clearance, estimated path loss, link margin.
- **"What can I reach from here?"** Choose a location and one or more networks. For each network, show the nearby existing repeaters/routers and whether each is predicted to be reachable from the chosen location with the chosen hardware. Present MeshCore and Meshtastic side by side.
- **Network presence summary** for the area: counts of nodes by role and recency for each network. Make clear this is *observed activity from public maps, not measured service quality*, and that stale or missing nodes skew it.
- A plain-language verdict that points at the evidence ("N repeaters of network A within X km, M predicted reachable; …") rather than naming a winner.

### M3 — A whole plan
- Multiple planned nodes in one plan, mixed networks allowed.
- Combined coverage with a best-server view; "add this node to the existing network and show what changes".
- Viewshed from a point.
- **Placement help:** suggest candidate sites to improve coverage of a drawn area, with the reasoning shown. Suggestions are ranked by coverage gained, never by anything commercial.
- Regulatory presets per region/band, applied to defaults and warnings (power and duty-cycle limits).

### M4 — Hardware and bill of materials
- A browsable hardware catalogue covering the components a plan needs: devices, antennas, cables/connectors, power (battery/solar), enclosures, mounting.
- Choosing a device in the planner sets its radio capabilities and defaults; the catalogue explains trade-offs in plain language.
- Plan → **bill of materials** (what to buy for each planned node), with retailer links (see below).
- Compatibility hints (band/region, connector type, network firmware support) so people don't buy the wrong thing.
- Power budgeting: estimate battery/solar needs per node for the chosen duty cycle and climate.

### M5 — Network analysis and polish
- Topology graph, critical-node detection, simple resilience metrics (what breaks if this node goes down).
- Airtime and capacity estimates for the chosen preset and node count.
- Exports: PDF report, KML, CSV, plan file. Import: plan file, CSV of node positions.
- Offline-friendly: cached terrain and app shell so a plan can be reopened without a connection.

## Hardware & affiliate links

The author wants the service to be free for users, with affiliate commissions as the way to cover effort and cost. That works best when it is transparent and the advice is trustworthy.

**Rules**

1. **Always disclose.** A visible disclosure on every page that contains affiliate links, in the wording each programme requires, plus a standing "How we make money" page. The landing page currently contains placeholder disclosure text that must be replaced with the programme's real wording before any affiliate link goes live.
2. **Independence.** Product order, "best for" labels, placement suggestions and compatibility advice are decided on merit and never by commission rate. Where a product is available from a non-affiliate source, say so or show it too.
3. **Links, not prices.** Don't scrape or cache retailer prices; programme terms often restrict displaying stale or scraped prices. Link out, optionally with an editorial "typical price range, checked on <date>".
4. **Mark links properly:** `rel="sponsored noopener"` on affiliate links.
5. **Don't leak affiliate IDs into shared artefacts.** Plan files and shared links store product identifiers, not tracking URLs; affiliate URLs are generated at display time. BOM exports include them only if the user opts in.
6. **Per-region retailers.** A product can have several retailer entries (by country), so a user in the EU isn't sent to a US shop that doesn't ship.
7. **Programme terms are the source of truth.** Each programme has its own rules (disclosure wording, link placement, prohibited uses). Review them before signing up and record the relevant constraints next to the programme in the catalogue docs.

**Catalogue data model (sketch):** a data file of products with category, model, network support, band(s), key specs, a short plain-language note, and a list of retailer entries `{region, retailer, url_template, affiliate: true|false}`. Specs are filled from manufacturers' own documentation and re-checked periodically; each entry records when it was last verified.

This also replaces the four placeholder cards on the landing page's hardware section, which are fed from the same catalogue.

## Propagation engine requirements

- **Model:** Longley-Rice / ITM point-to-point for links and area prediction for coverage, with an optional terrain-clutter loss assumption for built-up or wooded areas so results are less optimistic than bare terrain.
- **Runs in the browser:** worker threads, resumable and cancellable, no server. Must work without cross-origin-isolation headers (static hosting).
- **Terrain:** free public elevation tiles (open data), cached locally; selectable resolution trading accuracy for speed; sea level where no data exists.
- **Outputs:** a raster of received signal in dBm plus bounds, so display options re-render without recomputing; contour polygons derived from it.
- **Inputs:** frequency, transmit power, antenna gains, cable and connector loss, heights, receiver sensitivity (from radio preset), climate/ground parameters with sane defaults.
- **Validation:** build a test suite of published ITM reference cases and a small set of hand-checked links; run in CI. Record known limitations next to the results users see.
- **Performance targets (to be confirmed by measurement):** a typical single-node coverage run should complete in seconds on a mid-range laptop and in a tolerable time on a recent phone, with progress shown.

## Non-goals for v1

- Accounts, server-side storage, collaboration or payments.
- Real-time node telemetry or live message traffic.
- Photo-realistic 3D. (A 3D terrain view may come later as a display option; coverage correctness comes first.)
- Anything that implies a guaranteed result. Estimates only.

## Open questions

1. **Engine source and licence.** Which permissive/public-domain ITM implementation, or a from-scratch implementation? Verify and record the licence before adopting. (Do not use code derived from SPLAT!.)
2. **Basemap tiles.** The main map uses public OpenStreetMap tile servers, whose usage policy discourages heavy use. The planner needs a basemap source that is free, policy-compliant and suitable for terrain styling. Options include self-hosted vector tiles or a free-tier provider; decide before launch.
3. **Map renderer for the planner.** A WebGL map with terrain support is likely better than Leaflet for coverage overlays and terrain; confirm after a small spike.
4. **Repository licence.** This repository currently has no licence file. Choose one before accepting outside contributions — it determines how the planner can be reused and whether the clean-room rules need extending.
5. **Affiliate programmes.** Which programmes (and regions) to join; their disclosure wording and rules.
6. **Hardware scope for the first catalogue.** Which devices and accessories launch first.
7. **Data freshness.** Node snapshots are refreshed every 30 minutes by CI; confirm that is fine for "what's near me", and how stale-node handling should appear in the presence summary.
8. **Where a shared link stores a plan** with no backend (URL fragment size limits; fall back to file export for large plans).

## Suggested order of work

M0 → M1 first, then ship and learn. M1 alone (one node, real terrain, both networks' existing nodes visible, shareable link) is already more convenient than anything that makes people hop between sites. Then M2, which is the distinctive part, then M3–M5.

## Decisions so far

Recorded while building M0 and M1, so the open questions above can be closed or revisited.

1. **Engine source and licence — resolved.** The engine is a TypeScript port of NTIA's reference ITM (<https://github.com/NTIA/itm>), a US-government work released for any use with acknowledgement and a note of modifications (see `planner/NOTICE.md`). No SPLAT! or other GPL code is used. It is verified against NTIA's original C++ on 225 paths to about 5e-11 dB. As with any licence reading, have someone qualified confirm it before relying on it commercially.
2. **Terrain.** AWS Terrain Tiles (Terrarium PNG) — free, keyless, cross-origin, whole world. Fetched in the browser; failures are errors, not flat ground.
3. **Basemap — provisional.** Street vector tiles from OpenFreeMap (free, no key), Esri World Imagery for satellite (as on the live map), and a **Topo** view (elevation tint, hillshade and labelled contour lines, drawn in the browser with `maplibre-contour` from the same terrain tiles), which is also the automatic fallback. Topo has no road or place names. Third-party topo tile servers (OpenTopoMap, Esri) were not used: OpenTopoMap has no usage policy we could confirm and runs on donated servers, and neither could be previewed from the build sandbox. The OpenFreeMap and Esri endpoints could not be reached from the build sandbox, so verify them on the deployed site.
4. **Renderer.** MapLibre GL (not Leaflet), as proposed; the live map stays on Leaflet.
5. **Cautious planning** applies 90% to both ITM's time and situation variability. Time variability alone changes the result by under 2 dB, so it would have made "cautious" almost meaningless.
6. **Radio presets** list only what could be confirmed from public docs (Meshtastic's 250 kHz presets and MeshCore's US/Canada setting); everything else is a custom SF/bandwidth entry. Each preset records its source.
7. **Honest defaults.** The extra-loss allowance defaults to 0 dB (bare terrain), and the results panel says so whenever it is 0. Coverage that reaches the edge of the range is flagged as clipped.
8. **Sharing.** The whole scenario lives in the URL hash (and the planner follows hash changes), which also carries "Plan coverage from here" from the live map, including the selected countries.
9. **Privacy wording.** Settings never leave the browser; map and terrain tiles come from public servers, which can see roughly which area is viewed. The landing page and planner say exactly that.
