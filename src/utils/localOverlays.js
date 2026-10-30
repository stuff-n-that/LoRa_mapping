import { meshcoreRoleCategory, meshtasticRoleCategory } from './nodeRoles.js'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FEATURES = 10000
export const MAX_LAYERS = 8
export const OVERLAY_COLORS = ['#ffb347', '#ed78cb', '#8bd17c', '#b49aff', '#67d9df', '#ff826f', '#e6d467', '#a9c8ff']
const ROLES = { 1: 'Client', 2: 'Repeater', 3: 'Room Server', 4: 'Sensor' }
const MESHTASTIC_ROLES = ['CLIENT', 'CLIENT_MUTE', 'ROUTER', 'ROUTER_CLIENT', 'REPEATER', 'TRACKER', 'SENSOR', 'TAK', 'CLIENT_HIDDEN', 'LOST_AND_FOUND', 'TAK_TRACKER', 'ROUTER_LATE', 'CLIENT_BASE']
const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 160) : fallback
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const publicKey = value => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value) ? value.toLowerCase() : null
const advertisedTime = value => (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && Number.isFinite(Date.parse(value))) ? value : null

export function meshtasticNodeId(value) {
  if (typeof value === 'string') {
    if (/^![a-f\d]{8}$/i.test(value)) return value.toLowerCase()
    if (/^0x[a-f\d]{1,8}$/i.test(value)) value = Number.parseInt(value.slice(2), 16)
    else if (/^\d{1,10}$/.test(value)) value = Number(value)
    else return null
  }
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? `!${value.toString(16).padStart(8, '0')}` : null
}

function meshtasticRole(value) {
  // Omitted proto enum values default to CLIENT; future/unknown roles stay other.
  const number = value == null ? 0 : typeof value === 'number' ? value : MESHTASTIC_ROLES.indexOf(text(value).toUpperCase())
  return { role: MESHTASTIC_ROLES[number] || text(value, 'Unknown'), roleCategory: meshtasticRoleCategory(number) }
}

function positionDegrees(position, axis) {
  if (position[axis] !== undefined) return position[axis]
  const fixed = position[`${axis}I`] ?? position[`${axis}_i`]
  if (typeof fixed !== 'number') return fixed
  return Number.isInteger(fixed) && fixed >= -0x80000000 && fixed <= 0x7fffffff ? fixed / 1e7 : NaN
}

function meshtasticRecords(data) {
  if (!object(data)) return null
  const candidate = object(data.nodes) || Array.isArray(data.nodes) ? data.nodes : object(data.nodesById) ? data.nodesById : data
  const entries = Object.entries(candidate)
  const keyedId = key => Array.isArray(candidate) ? null : meshtasticNodeId(key)
  const explicit = data.network === 'meshtastic' || data.format === 'meshtastic-node-snapshot-v1'
  const looksLikeNodes = entries.length > 0 && entries.some(([key, c]) => object(c) && (object(c.user) || object(c.position)) && (meshtasticNodeId(c.num) || meshtasticNodeId(c.user?.id) || keyedId(key)))
  if (!explicit && !looksLikeNodes) return null
  return entries.map(([key, c]) => {
    const position = object(c?.position) ? c.position : {}
    return {
      network: 'meshtastic', nodeId: meshtasticNodeId(c?.num) || meshtasticNodeId(c?.user?.id) || keyedId(key),
      name: text(c?.user?.longName) || text(c?.user?.shortName) || text(c?.user?.id) || key,
      lat: positionDegrees(position, 'latitude'), lng: positionDegrees(position, 'longitude'),
      ...meshtasticRole(c?.user?.role), lastHeardAt: advertisedTime(c?.lastHeard),
      hopsAway: Number.isInteger(c?.hopsAway) && c.hopsAway >= 0 ? c.hopsAway : null,
      snr: Number.isFinite(c?.snr) ? c.snr : null, viaMqtt: c?.viaMqtt === true,
    }
  })
}

export function identity(node) {
  if (node.network === 'meshtastic') {
    const suffix = typeof node.id === 'string' ? node.id.match(/meshtastic-live-(.+)$/)?.[1] : null
    const id = meshtasticNodeId(node.nodeId) || meshtasticNodeId(suffix)
    return id ? `meshtastic:${id}` : null
  }
  if (node.network !== 'meshcore') return null
  const key = publicKey(node.publicKey) || publicKey(node.id?.match(/meshcore-live-([a-f\d]{64})$/i)?.[1])
  return key ? `meshcore:${key}` : null
}

export function distanceMetres(a, b) {
  const rad = Math.PI / 180
  const q = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, q)))
}

// Whitelist fields: never retain channel secrets, PINs, private keys, or raw imports.
export function parseLocalOverlay(content, filename) {
  let data
  try { data = JSON.parse(content) } catch { throw new Error('This file is not valid JSON. Choose MeshCore or Meshtastic node JSON, or point GeoJSON.') }
  let records, format, label, capturedAt
  if (object(data) && object(data.contacts)) {
    records = Object.entries(data.contacts).map(([key, c]) => ({
      record: c, publicKey: publicKey(c?.public_key) || publicKey(key), network: 'meshcore',
      lat: c?.adv_lat, lng: c?.adv_lon, name: c?.adv_name,
      role: typeof c?.type === 'number' ? ROLES[c.type] : null,
      roleCategory: typeof c?.type === 'number' ? meshcoreRoleCategory(c.type) : 'other', advertisedAt: advertisedTime(c?.last_advert),
    }))
    format = 'MeshCore snapshot'
    label = text(data.self_info?.name) || text(data.selfInfo?.name) || filename
    capturedAt = data.captured_at_utc
  } else if (object(data) && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    records = data.features.map(f => {
      const p = object(f?.properties) ? f.properties : {}
      const isPoint = f?.type === 'Feature' && f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)
      const coords = isPoint ? f.geometry.coordinates : []
      const nodeId = meshtasticNodeId(p.nodeId) || meshtasticNodeId(p.node_id) || meshtasticNodeId(p.num)
      const network = p.network === 'meshtastic' || (p.network !== 'meshcore' && nodeId) ? 'meshtastic' : (p.network === 'meshcore' || publicKey(p.publicKey || p.public_key) ? 'meshcore' : 'unknown')
      const role = text(p.role || p.roleRaw)
      const roleInfo = network === 'meshtastic' ? meshtasticRole(p.role || p.roleRaw) : { role, roleCategory: new Map([['Client', 'client'], ['Repeater', 'repeater'], ['Room Server', 'room-server'], ['Sensor', 'sensor']]).get(role) || 'other' }
      return { invalidGeometry: !isPoint, network, nodeId, publicKey: publicKey(p.publicKey || p.public_key), lat: coords[1], lng: coords[0], name: p.name, ...roleInfo, advertisedAt: advertisedTime(p.lastAdvert), lastHeardAt: advertisedTime(p.lastHeard) }
    })
    format = 'GeoJSON'
    label = text(data.name) || filename
    capturedAt = data.snapshotAt
  } else {
    records = meshtasticRecords(data)
    if (!records) throw new Error('Unsupported format. Use MeshCore contacts JSON, Meshtastic nodes JSON, or a GeoJSON FeatureCollection of points.')
    format = 'Meshtastic snapshot'
    const ownId = meshtasticNodeId(data.my_info?.myNodeNum ?? data.myInfo?.myNodeNum)
    label = (ownId ? records.find(r => r.nodeId === ownId)?.name : null) || text(data.bluetooth_name) || filename
    capturedAt = data.captured_at_utc
  }
  if (records.length > MAX_FEATURES) throw new Error(`This file has too many records. The limit is ${MAX_FEATURES.toLocaleString()}.`)
  const report = { total: records.length, noPosition: 0, invalid: 0, duplicates: 0, noIdentity: 0, details: [] }
  const nodes = new Map()
  records.forEach((r, index) => {
    const name = text(r.name, `Contact ${index + 1}`) || `Contact ${index + 1}`
    let reason
    if (r.invalidGeometry) { report.invalid++; reason = 'Invalid or non-point geometry' }
    else if (r.lat == null || r.lng == null || (r.lat === 0 && r.lng === 0)) { report.noPosition++; reason = 'No position' }
    else if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng) || Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180) { report.invalid++; reason = 'Invalid position or non-point geometry' }
    if (reason) { report.details.push({ name, reason }); return }
    const node = { id: `point-${index}`, name, lat: r.lat, lng: r.lng, network: r.network, publicKey: r.publicKey || null, nodeId: r.nodeId || null, roleRaw: r.role || null, roleCategory: r.roleCategory, advertisedAt: r.advertisedAt || null, lastHeardAt: r.lastHeardAt || null, hopsAway: r.hopsAway ?? null, snr: r.snr ?? null, viaMqtt: r.viaMqtt === true, source: 'local' }
    const key = identity(node) || node.id
    if (nodes.has(key)) { report.duplicates++; report.details.push({ name, reason: 'Duplicate identity; last position retained' }) }
    if (!identity(node)) report.noIdentity++
    nodes.set(key, node)
  })
  if (nodes.size === 0) throw new Error(`No usable positions in this ${format} (${report.noPosition} without coordinates; ${report.invalid} invalid). Existing layers have been kept.`)
  return {
    name: label, filename, format,
    capturedAt: typeof capturedAt === 'string' && Number.isFinite(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : null,
    nodes: [...nodes.values()], report,
  }
}

export async function readOverlayFile(file) {
  if (!file || file.size > MAX_FILE_BYTES) throw new Error('Choose a JSON or GeoJSON file smaller than 5 MB.')
  return parseLocalOverlay(await file.text(), file.name)
}

export function droppedOverlayFile(transfer) {
  const files = Array.from(transfer?.files || [])
  if (files.length !== 1) throw new Error('Drop one JSON or GeoJSON file at a time. Existing layers have been kept.')
  return files[0]
}

// Only compare against currently loaded public records and enabled local layers.
// A missing identity is unmatchable, not evidence of absence from the public feed.
export function compareOverlays(publicNodes, layers, view = 'all') {
  const publicIndex = new Map(publicNodes.map(n => [identity(n), n]).filter(([key]) => key))
  const localKeys = new Set(layers.filter(l => l.enabled).flatMap(l => l.nodes.map(identity)).filter(Boolean))
  const counts = { both: 0, localOnly: 0, publicOnly: 0, unmatchable: 0 }
  for (const key of localKeys) counts[publicIndex.has(key) ? 'both' : 'localOnly']++
  for (const key of publicIndex.keys()) if (!localKeys.has(key)) counts.publicOnly++
  const localLayers = layers.filter(l => l.enabled).map(layer => ({ ...layer, nodes: layer.nodes.map(node => {
    const key = identity(node), match = key ? publicIndex.get(key) : null
    const comparison = !key ? 'unmatchable' : match ? 'both' : 'local-only'
    if (!key) counts.unmatchable++
    return { ...node, comparison, publicMatch: match || null, positionDifference: match ? distanceMetres(node, match) : null }
  }).filter(n => view === 'all' || (view === 'both' && n.comparison === 'both') || (view === 'local-only' && n.comparison === 'local-only')) }))
  return {
    counts, localLayers,
    publicNodes: publicNodes.filter(n => {
      if (view === 'all') return true
      const key = identity(n)
      if (!key) return false
      return view === 'both' ? localKeys.has(key) : view === 'public-only' ? !localKeys.has(key) : false
    }),
  }
}
