import test from 'node:test'
import assert from 'node:assert/strict'
import { compareOverlays, droppedOverlayFile, identity, meshtasticNodeId, parseLocalOverlay, readOverlayFile, MAX_FILE_BYTES } from '../src/utils/localOverlays.js'

const keyA = 'a'.repeat(64), keyB = 'b'.repeat(64), keyC = 'c'.repeat(64)
const contact = (key, name, lat = 51.5, lon = -0.1) => ({ public_key: key, adv_name: name, adv_lat: lat, adv_lon: lon, type: 2 })
const parse = obj => parseLocalOverlay(JSON.stringify(obj), 'contacts.json')
const snapshot = contacts => ({ self_info: { name: 'Test radio' }, captured_at_utc: '2026-01-01T12:00:00Z', contacts })
const point = (properties = {}, coordinates = [-0.1, 51.5]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties })

test('dropped files use the same local importer; multiple files and non-file drops are rejected', async () => {
  const file = { name: 'dropped.geojson', size: 100, text: async () => JSON.stringify({ type: 'FeatureCollection', features: [point({ name: 'Dropped' })] }) }
  const result = await readOverlayFile(droppedOverlayFile({ files: [file] }))
  assert.equal(result.nodes[0].name, 'Dropped')
  assert.throws(() => droppedOverlayFile({ files: [] }), /Drop one/)
  assert.throws(() => droppedOverlayFile({ files: [file, file] }), /Drop one/)
  assert.throws(() => droppedOverlayFile(null), /Drop one/)
})

test('imports MeshCore identity and capture time while discarding secrets and raw fields', () => {
  const data = snapshot({ [keyA]: { ...contact(keyA, '<script>test</script>'), private_key: 'SECRET', channel_secret: 'SECRET' } })
  data.security = { private_key: 'SECRET' }
  const result = parse(data)
  assert.equal(result.name, 'Test radio')
  assert.equal(result.nodes[0].publicKey, keyA)
  assert.equal(result.nodes[0].name, '<script>test</script>') // React renders this as text.
  assert.equal(result.capturedAt, '2026-01-01T12:00:00.000Z')
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
})

test('omits absent positions, zero-zero, strings, and out-of-range coordinates with separate counts', () => {
  const result = parse(snapshot({
    a: contact(keyA, 'Valid'), b: contact(keyB, 'Missing', 0, 0),
    c: contact(keyC, 'Invalid', 2147, 0), d: contact(null, 'String', '51', 0),
    e: contact(null, 'Null', null, null),
  }))
  assert.equal(result.nodes.length, 1)
  assert.equal(result.report.noPosition, 2)
  assert.equal(result.report.invalid, 2)
  assert.equal(result.report.details.length, 4)
})

test('deduplicates full identities, retaining the final position, but keeps separate nameless identities', () => {
  const result = parse(snapshot({ a: contact(keyA, 'Old'), b: contact(keyA, 'New', 52, 0), c: contact(null, 'Other') }))
  assert.equal(result.nodes.length, 2)
  assert.equal(result.report.duplicates, 1)
  assert.equal(result.nodes[0].name, 'New')
  assert.equal(result.report.noIdentity, 1)
})

test('GeoJSON point coordinates are longitude then latitude; unknown identities still plot', () => {
  const result = parse({ type: 'FeatureCollection', features: [point({ name: 'First', publicKey: keyA }), point({ name: 'No key' })] })
  assert.equal(result.nodes[0].lat, 51.5)
  assert.equal(result.nodes[0].lng, -0.1)
  assert.equal(result.nodes[0].network, 'meshcore')
  assert.equal(result.nodes[1].network, 'unknown')
  assert.equal(result.report.noIdentity, 1)
})

test('rejects malformed, unsupported, empty, and excessive imports', () => {
  assert.throws(() => parseLocalOverlay('{', 'file.json'), /not valid JSON/)
  assert.throws(() => parse([]), /Unsupported format/)
  assert.throws(() => parse({ contacts: null }), /Unsupported format/)
  assert.throws(() => parse(snapshot({})), /No usable positions/)
  assert.throws(() => parse({ type: 'FeatureCollection', features: Array(10001).fill(point()) }), /too many records/)
})

test('rejects non-point GeoJSON geometries without coercing them into coordinates', () => {
  const result = parse({ type: 'FeatureCollection', features: [point(), { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 51], [1, 52]] } }] })
  assert.equal(result.nodes.length, 1)
  assert.equal(result.report.invalid, 1)
})

test('untrusted role and timestamp fields cannot introduce objects into popup fields', () => {
  const result = parse(snapshot({ a: { ...contact(keyA, 'Test'), type: '__proto__', last_advert: { toString: null } } }))
  assert.equal(result.nodes[0].roleRaw, null)
  assert.equal(result.nodes[0].roleCategory, 'other')
  assert.equal(result.nodes[0].advertisedAt, null)
  const geo = parse({ type: 'FeatureCollection', features: [point({ role: '__proto__' })] })
  assert.equal(geo.nodes[0].roleCategory, 'other')
})

test('checks file size before reading file content', async () => {
  let wasRead = false
  await assert.rejects(readOverlayFile({ size: MAX_FILE_BYTES + 1, text() { wasRead = true } }), /smaller than 5 MB/)
  assert.equal(wasRead, false)
})

test('matches full keys despite changed names and measures divergent positions', () => {
  const publicNodes = [{ id: `snapshot-meshcore-live-${keyA}`, name: 'Renamed', network: 'meshcore', lat: 52, lng: -0.1 }, { id: `meshcore-live-${keyB}`, network: 'meshcore', lat: 51, lng: 0 }]
  const layer = { ...parse(snapshot({ a: contact(keyA, 'Original'), c: contact(keyC, 'Local only'), d: contact(null, 'Unknown') })), enabled: true }
  const result = compareOverlays(publicNodes, [layer])
  assert.deepEqual(result.counts, { both: 1, localOnly: 1, publicOnly: 1, unmatchable: 1 })
  assert.ok(result.localLayers[0].nodes[0].positionDifference > 50000)
  assert.equal(result.localLayers[0].nodes[0].publicMatch.name, 'Renamed')
  assert.equal(compareOverlays(publicNodes, [layer], 'both').localLayers[0].nodes.length, 1)
  assert.equal(compareOverlays(publicNodes, [layer], 'local-only').localLayers[0].nodes.length, 1)
  assert.equal(compareOverlays(publicNodes, [layer], 'public-only').localLayers[0].nodes.length, 0)
  assert.equal(compareOverlays(publicNodes, [layer], 'public-only').publicNodes.length, 1)
})

test('disabled layers do not affect matches; equal names and different networks do not establish identity', () => {
  const layer = { ...parse(snapshot({ a: contact(keyA, 'Same name') })), enabled: false }
  const pub = [{ id: `meshcore-live-${keyB}`, name: 'Same name', network: 'meshcore', lat: 51.5, lng: 0 }]
  assert.equal(compareOverlays(pub, [layer]).counts.localOnly, 0)
  assert.equal(compareOverlays(pub, [{ ...layer, enabled: true }]).counts.both, 0)
  assert.equal(compareOverlays([{ ...pub[0], publicKey: keyA, network: 'meshtastic' }], [{ ...layer, enabled: true }]).counts.both, 0)
})

test('Meshtastic IDs normalize unsigned numbers and explicit hex without ambiguous bare hex', () => {
  assert.equal(meshtasticNodeId(305419896), '!12345678')
  assert.equal(meshtasticNodeId('305419896'), '!12345678')
  assert.equal(meshtasticNodeId('!ABCDEF01'), '!abcdef01')
  assert.equal(meshtasticNodeId('0x1234'), '!00001234')
  assert.equal(meshtasticNodeId(0x80000000), '!80000000')
  for (const bad of [-1, 0x100000000, 12.5, 'abcdef01', {}, null]) assert.equal(meshtasticNodeId(bad), null)
})

test('imports native Meshtastic node JSON, degree and fixed-point positions, and both role representations', () => {
  const result = parse({ network: 'meshtastic', captured_at_utc: '2026-01-01T12:00:00Z', my_info: { myNodeNum: 305419896 }, nodes: {
    '!12345678': { num: 305419896, user: { id: '!12345678', longName: 'Local radio', role: 'CLIENT_BASE', privateKey: 'SECRET' }, position: { latitude: 51.5, longitude: -0.1 }, lastHeard: 1767268800, hopsAway: 0, snr: 5.5, viaMqtt: true },
    '!00000002': { num: 2, user: { shortName: 'RPTR', role: 2 }, position: { latitudeI: 520000000, longitudeI: -20000000 } },
  }, security: { privateKey: 'SECRET' } })
  assert.equal(result.format, 'Meshtastic snapshot')
  assert.equal(result.name, 'Local radio')
  assert.equal(result.nodes[0].roleCategory, 'client')
  assert.equal(result.nodes[0].lastHeardAt, 1767268800)
  assert.equal(result.nodes[0].advertisedAt, null)
  assert.equal(result.nodes[0].hopsAway, 0)
  assert.equal(result.nodes[0].viaMqtt, true)
  assert.equal(result.nodes[1].lat, 52)
  assert.equal(result.nodes[1].lng, -2)
  assert.equal(result.nodes[1].roleCategory, 'repeater')
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
})

test('supports raw node dictionaries, nodesById, arrays, and snake-case fixed-point coordinates', () => {
  const node = { num: 2, user: { id: '!00000002', role: 'TRACKER' }, position: { latitude_i: 515000000, longitude_i: -1000000 } }
  for (const data of [{ '!00000002': node }, { nodesById: { '!00000002': node } }, { nodes: [node] }]) {
    const result = parse(data)
    assert.equal(result.nodes[0].nodeId, '!00000002')
    assert.equal(result.nodes[0].lat, 51.5)
    assert.equal(result.nodes[0].roleCategory, 'sensor')
  }
  const withoutId = parse({ network: 'meshtastic', nodes: [{ user: { longName: 'Unknown ID' }, position: { latitude: 51.5, longitude: -0.1 } }] })
  assert.equal(withoutId.nodes[0].nodeId, null)
  assert.equal(identity(withoutId.nodes[0]), null) // An array index is not a radio ID.
})

test('positionless Meshtastic export is recognized and explains why no marker can be added', () => {
  // Same field structure as a hardware export, using synthetic identities only.
  const data = { format: 'meshtastic-node-snapshot-v1', network: 'meshtastic', my_info: { myNodeNum: 1 }, nodes: {
    '!00000001': { num: 1, user: { longName: 'Test radio' }, deviceMetrics: { batteryLevel: 101 } },
    '!00000002': { num: 2, user: { longName: 'Peer' }, lastHeard: 123, hopsAway: 0 },
  } }
  assert.throws(() => parse(data), /Meshtastic snapshot \(2 without coordinates; 0 invalid\)/)
})

test('Meshtastic positions are validated without guessing, coercion or assigned coordinates', () => {
  const result = parse({ network: 'meshtastic', nodes: {
    a: { num: 1, position: { latitude: 0, longitude: -0.1 } },
    b: { num: 2, position: { latitudeI: 2147483647, longitudeI: 0 } },
    c: { num: 3, position: { latitude: '51.5', longitude: 0 } },
    d: { num: 4, position: { latitudeI: 0, longitudeI: 0 } },
  } })
  assert.equal(result.nodes.length, 1)
  assert.equal(result.report.invalid, 2)
  assert.equal(result.report.noPosition, 1)
  assert.equal(result.nodes[0].roleRaw, 'CLIENT')
})

test('Meshtastic node IDs match decimal public-feed IDs and GeoJSON identities independently of MeshCore', () => {
  const layer = { ...parse({ nodes: { '!12345678': { num: 305419896, user: { longName: 'Old name' }, position: { latitude: 51.5, longitude: -0.1 } } } }), enabled: true }
  const pub = [{ id: 'snapshot-meshtastic-live-305419896', network: 'meshtastic', name: 'New name', lat: 51.5, lng: -0.1 }]
  assert.equal(compareOverlays(pub, [layer]).counts.both, 1)
  const geo = parse({ type: 'FeatureCollection', features: [point({ network: 'meshtastic', nodeId: '!12345678', role: 'ROUTER' })] })
  assert.equal(identity(geo.nodes[0]), identity(pub[0]))
  assert.equal(geo.nodes[0].roleCategory, 'repeater')
  assert.equal(compareOverlays([{ ...pub[0], network: 'meshcore' }], [layer]).counts.both, 0)
})
