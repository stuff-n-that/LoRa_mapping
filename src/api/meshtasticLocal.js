// Turns the node database read directly off YOUR Meshtastic hardware into
// the same node shape the rest of the app already uses — this is the
// "ground truth" counterpart to meshtasticLive.js's community-API data.
//
// Deliberately split from the actual device connection: normalizeLocalNodes
// below takes plain data and is fully testable without any hardware
// attached. Getting that data off a real device (scripts/local-node/, see
// its own header comment) is the part that still needs a real laptop + node
// to verify — the meshtastic-python library's `Interface.nodes` shape this
// assumes is well-established and used by other community tools (the same
// field names — hopsAway, snr, lastHeard — already show up in the
// liamcottle/meshtastic-map schema this project integrates with elsewhere),
// but hasn't been smoke-tested against a real device from here.
import { meshtasticRoleCategory } from '../utils/nodeRoles.js'

// hopsAway === 0 means you received it directly, no relay in between — the
// signal this whole ground-truth feature exists to check. A node can be in
// your local node database (multi-hop, from other nodes' gossip) without
// ever being heard directly; only hopsAway === 0 counts as "you can vouch
// for this one yourself".
function isDirectNeighbour(rawNode) {
  return rawNode.hopsAway === 0
}

function normalizeOne(nodeId, rawNode) {
  const position = rawNode.position
  if (!position || typeof position.latitude !== 'number' || typeof position.longitude !== 'number') return null

  const user = rawNode.user || {}
  const name = user.longName || user.shortName || nodeId

  return {
    id: `meshtastic-local-${nodeId}`,
    name,
    network: 'meshtastic',
    lat: position.latitude,
    lng: position.longitude,
    hardware: typeof user.hwModel === 'string' ? user.hwModel : '',
    notes: '',
    lastSeen: rawNode.lastHeard ? new Date(rawNode.lastHeard * 1000).toISOString() : '',
    source: 'local',
    roleCategory: meshtasticRoleCategory(typeof user.role === 'number' ? user.role : undefined),
    roleRaw: null,
    heardDirectly: isDirectNeighbour(rawNode),
    snr: typeof rawNode.snr === 'number' ? rawNode.snr : null,
    hopsAway: typeof rawNode.hopsAway === 'number' ? rawNode.hopsAway : null,
  }
}

// nodesById mirrors meshtastic-python's `Interface.nodes`: an object keyed
// by node id (e.g. "!433d2ab8") whose values carry `user`, `position`,
// `snr`, `hopsAway`, `lastHeard`. Nodes with no position yet (never got a
// GPS fix, or you haven't heard a position packet from them) are dropped,
// same as the live-API normalizers already do — there's nowhere to plot them.
export function normalizeLocalNodes(nodesById) {
  return Object.entries(nodesById || {})
    .map(([nodeId, rawNode]) => normalizeOne(nodeId, rawNode))
    .filter(Boolean)
}
