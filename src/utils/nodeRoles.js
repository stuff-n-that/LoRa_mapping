// Normalizes MeshCore's node "type" and Meshtastic's node "role" — two
// different small integer enums from two unrelated projects — into one
// shared set of categories so a single filter UI can cover both networks.
//
// MeshCore types (src/api/meshcoreLive.js NODE_TYPES): Client, Repeater,
// Room Server, Sensor.
// Meshtastic roles (meshtastic/protobufs meshtastic/config.proto,
// DeviceConfig.Role — confirmed against the public API's own
// src/json/roles.json in liamcottle/meshtastic-map): CLIENT, CLIENT_MUTE,
// ROUTER, ROUTER_CLIENT, REPEATER, TRACKER, SENSOR, TAK, CLIENT_HIDDEN,
// LOST_AND_FOUND, TAK_TRACKER, ROUTER_LATE, CLIENT_BASE.
//
// Every node from either network is always assigned exactly one category —
// including 'other' for a value neither map recognizes, or one that's
// missing/null. That "other" bucket exists specifically so an unparseable
// or unmapped role never silently disappears: it's just another checkbox,
// on by default, not a hidden default-exclude.
export const ROLE_CATEGORIES = [
  { key: 'repeater', label: 'Repeater / Router' },
  { key: 'client', label: 'Client' },
  { key: 'sensor', label: 'Sensor / Tracker' },
  { key: 'room-server', label: 'Room Server' },
  { key: 'other', label: 'Other / Unknown' },
]

const MESHCORE_TYPE_TO_CATEGORY = {
  1: 'client',
  2: 'repeater',
  3: 'room-server',
  4: 'sensor',
}

const MESHTASTIC_ROLE_TO_CATEGORY = {
  0: 'client', // CLIENT
  1: 'client', // CLIENT_MUTE
  2: 'repeater', // ROUTER
  3: 'repeater', // ROUTER_CLIENT
  4: 'repeater', // REPEATER
  5: 'sensor', // TRACKER
  6: 'sensor', // SENSOR
  7: 'sensor', // TAK
  8: 'client', // CLIENT_HIDDEN
  9: 'sensor', // LOST_AND_FOUND
  10: 'sensor', // TAK_TRACKER
  11: 'repeater', // ROUTER_LATE
  12: 'client', // CLIENT_BASE
}

export function meshcoreRoleCategory(typeNum) {
  return MESHCORE_TYPE_TO_CATEGORY[typeNum] || 'other'
}

export function meshtasticRoleCategory(roleNum) {
  if (typeof roleNum !== 'number') return 'other'
  return MESHTASTIC_ROLE_TO_CATEGORY[roleNum] || 'other'
}
