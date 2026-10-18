#!/usr/bin/env node
// Fetches building footprints (height + floor-count where Overture has
// them) for one or more countries and chunks them into a z14 slippy-tile
// grid, so the frontend can fetch just the tiles covering its current
// viewport instead of one huge per-country file — buildings are far denser
// than node points, so the per-country sharding that works for nodes
// doesn't scale the same way here. See scripts/lib/tileGrid.mjs for why z14.
//
// Tiles are written FLAT (public/buildings/<x>_<y>.json), not nested under
// a country folder: the frontend fetches purely by tile coordinate, with no
// need to know which country a given viewport is in (that would mean
// shipping the Node-only country-boundary lookup to the browser just to
// build a fetch URL). A tile with no file simply has no building data —
// not an error, just nothing drawn there.
//
// Downloaded as `-f geojsonseq` (one GeoJSON Feature per line) and streamed
// line-by-line, NOT as a single `geojson` FeatureCollection read into memory
// with JSON.parse: a real country-sized bbox (Denmark's mainland piece
// alone came back as 2.58M buildings / 1.7GB of text) exceeds V8's maximum
// string length long before it gets anywhere near that many buildings,
// which JSON.parse surfaces as an opaque RangeError — caught by an earlier,
// too-broad try/catch here and silently logged as "no data" rather than the
// real failure. Streaming avoids ever holding the raw download as one string.
//
// Tiles are also flushed to disk after each country PIECE rather than once
// at the very end of the whole run, so memory stays bounded to "one piece's
// buildings" instead of compounding across every requested country, and a
// later piece failing doesn't lose already-processed work.
//
// Needs the official Overture CLI on PATH: `pip install overturemaps`.
// https://docs.overturemaps.org/getting-data/overturemaps-py/
//
// Unlike pull-live-nodes.mjs, this is NOT run on the 30-minute schedule —
// building footprints don't change on that cadence, and a pull+simplify
// pass for a country takes real time (one bulk bbox download per country
// piece, not one request per tile — at z14 a mid-sized country can mean
// tens of thousands of tiles, so per-tile downloads would mean tens of
// thousands of API calls). Run it by hand for whichever countries you want
// building data available for.
//
// Usage: node scripts/pull-building-tiles.mjs <ISO-alpha-2> [<ISO-alpha-2> ...] [--out=<dir>]
//   node scripts/pull-building-tiles.mjs US KE PL
//   node scripts/pull-building-tiles.mjs US --out=public/buildings

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simplify from '@turf/simplify'
import { getCountryBBoxes, listCountries } from './lib/countryLookup.mjs'
import { BUILDING_TILE_ZOOM, lonToTileX, latToTileY, tileKey } from './lib/tileGrid.mjs'

const execFileAsync = promisify(execFile)

// Validated against real sample pulls (dense SF, Nairobi CBD, rural Poland):
// visually indistinguishable from the un-simplified footprint at this
// tolerance, and combined with dropping unneeded fields below cuts file
// size by roughly 55-65%.
const SIMPLIFY_TOLERANCE_DEG = 0.00002 // ~2.2m
const COORD_PRECISION = 5 // ~1.1m — matched to the simplify tolerance, no point keeping more

function roundCoords(coords, precision) {
  if (typeof coords[0] === 'number') {
    const factor = 10 ** precision
    return coords.map((c) => Math.round(c * factor) / factor)
  }
  return coords.map((c) => roundCoords(c, precision))
}

// Cheap "somewhere inside this building" point for bucketing into a tile —
// a true centroid isn't worth it here since buildings are tiny compared to
// a z14 tile (~1-2km), so which tile a building's point lands in is
// unambiguous except right at a tile boundary, which is harmless (the
// building still renders, just from its neighboring tile).
function geometryBBoxCenter(geometry) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

async function downloadBBox(bbox, outPath) {
  const [w, s, e, n] = bbox
  await execFileAsync(
    'overturemaps',
    ['download', `--bbox=${w},${s},${e},${n}`, '-f', 'geojsonseq', '--type=building', '-o', outPath],
    { maxBuffer: 1024 * 1024 * 10 },
  )
}

// Merges this run's in-memory tiles into whatever's already on disk for
// each one (a tile may already have a file from an earlier run over a
// neighboring country/piece) and clears the map afterward, so the caller's
// memory usage resets to zero between pieces instead of growing for the
// whole invocation.
async function flushTiles(tiles, outDir) {
  await mkdir(outDir, { recursive: true })
  let tileCount = 0
  for (const { x, y, features } of tiles.values()) {
    const path = join(outDir, `${x}_${y}.json`)
    let existingFeatures = []
    try {
      existingFeatures = JSON.parse(await readFile(path, 'utf8')).features || []
    } catch {
      // no existing tile, or unreadable — start fresh
    }
    const merged = [...existingFeatures, ...features]
    await writeFile(path, JSON.stringify({ type: 'FeatureCollection', features: merged }))
    tileCount++
  }
  tiles.clear()
  return tileCount
}

// Fetches, simplifies and tile-buckets one country, flushing to disk after
// each bbox piece. Returns running totals for the index — the actual tile
// files are already on disk by the time this returns.
async function processCountry(code, countryName, outDir, tmpDir) {
  const bboxes = getCountryBBoxes(code)
  if (!bboxes || bboxes.length === 0) {
    console.error(`No boundary found for ${code} — skipping.`)
    return null
  }

  let totalBuildings = 0
  let totalDropped = 0
  let tileFilesTouched = 0

  for (const [i, bbox] of bboxes.entries()) {
    const tmpFile = join(tmpDir, `${code}-${i}.ndjson`)
    console.log(`  piece ${i + 1}/${bboxes.length}: bbox [${bbox.map((n) => n.toFixed(3)).join(', ')}] ...`)
    try {
      await downloadBBox(bbox, tmpFile)
    } catch (err) {
      console.error(`  download failed for piece ${i + 1}: ${err.message}`)
      continue
    }

    const tiles = new Map() // "x_y" -> { x, y, features: [] } — this piece only
    let pieceBuildings = 0
    let pieceDropped = 0

    let rl
    try {
      rl = createInterface({ input: createReadStream(tmpFile, 'utf8'), crlfDelay: Infinity })
      for await (const line of rl) {
        if (!line.trim()) continue
        let feature
        try {
          feature = JSON.parse(line)
        } catch {
          continue // one malformed line shouldn't abort the whole piece
        }
        pieceBuildings++

        let geometry = feature.geometry
        try {
          const simplified = simplify(feature, { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: false, mutate: false })
          if (simplified.geometry?.coordinates?.length) geometry = simplified.geometry
        } catch {
          // keep the original (unsimplified) geometry rather than drop the building
        }
        if (!geometry) {
          pieceDropped++
          continue
        }
        geometry = { type: geometry.type, coordinates: roundCoords(geometry.coordinates, COORD_PRECISION) }

        const [cx, cy] = geometryBBoxCenter(feature.geometry)
        const x = lonToTileX(cx)
        const y = latToTileY(cy)
        const key = tileKey(x, y)
        if (!tiles.has(key)) tiles.set(key, { x, y, features: [] })

        const height = feature.properties?.height
        const levels = feature.properties?.num_floors
        tiles.get(key).features.push({
          type: 'Feature',
          geometry,
          properties: {
            h: typeof height === 'number' ? Math.round(height * 10) / 10 : null,
            lvl: typeof levels === 'number' ? levels : null,
          },
        })
      }
    } catch (err) {
      console.error(`  reading piece ${i + 1} failed: ${err.message}`)
    } finally {
      rl?.close()
      await rm(tmpFile, { force: true })
      await rm(`${tmpFile}.state`, { force: true })
    }

    const flushed = await flushTiles(tiles, outDir)
    tileFilesTouched += flushed
    totalBuildings += pieceBuildings
    totalDropped += pieceDropped
    console.log(`  piece ${i + 1}: ${pieceBuildings - pieceDropped}/${pieceBuildings} buildings kept across ${flushed} tiles`)
  }

  const kept = totalBuildings - totalDropped
  console.log(`  ${kept}/${totalBuildings} buildings kept across ~${tileFilesTouched} tile files for ${countryName}`)
  return { code, name: countryName, tileCount: tileFilesTouched, buildingCount: kept }
}

async function main() {
  let outDir = 'public/buildings'
  const codes = []
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--out=')) outDir = arg.slice('--out='.length)
    else codes.push(arg.toUpperCase())
  }

  if (codes.length === 0) {
    console.error('Usage: node scripts/pull-building-tiles.mjs <ISO-alpha-2> [<ISO-alpha-2> ...] [--out=<dir>]')
    console.error('Example: node scripts/pull-building-tiles.mjs US KE PL')
    process.exitCode = 1
    return
  }

  try {
    await execFileAsync('overturemaps', ['--version'])
  } catch {
    console.error('The `overturemaps` CLI is not on PATH. Install it with: pip install overturemaps')
    console.error('See https://docs.overturemaps.org/getting-data/overturemaps-py/')
    process.exitCode = 1
    return
  }

  const known = new Map(listCountries().map((c) => [c.code, c.name]))
  const tmpDir = await mkdtemp(join(tmpdir(), 'building-tiles-'))
  const results = []

  try {
    for (const code of codes) {
      const name = known.get(code)
      if (!name) {
        console.error(`Unknown country code "${code}" — skipping.`)
        continue
      }
      console.log(`${name} (${code}):`)
      const result = await processCountry(code, name, outDir, tmpDir)
      if (result) results.push(result)
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }

  // Tile files are already written (flushed per-piece above) — this just
  // rebuilds the maintainer-facing index.json manifest from the actual
  // directory contents plus this run's country-level tallies, since
  // per-tile counts weren't kept in memory across pieces/countries.
  const indexPath = join(outDir, 'index.json')
  let existing = { countries: [] }
  try {
    existing = JSON.parse(await readFile(indexPath, 'utf8'))
  } catch {
    // no index yet, or unreadable — start fresh
  }
  const countryByCode = new Map((existing.countries || []).map((c) => [c.code, c]))
  for (const r of results) {
    countryByCode.set(r.code, { code: r.code, name: r.name, tileCount: r.tileCount, buildingCount: r.buildingCount })
  }
  const mergedCountries = [...countryByCode.values()].sort((a, b) => a.name.localeCompare(b.name))

  await writeFile(
    indexPath,
    JSON.stringify({ zoom: BUILDING_TILE_ZOOM, generatedAt: new Date().toISOString(), countries: mergedCountries }, null, 2),
  )

  console.log(`\nDone. ${results.length} countr${results.length === 1 ? 'y' : 'ies'} written to ${outDir}/`)
}

main()
