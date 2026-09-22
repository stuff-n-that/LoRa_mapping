import L from 'leaflet'

const NETWORK_STYLE = {
  meshcore: { color: '#3aa0ff', label: 'C' },
  meshtastic: { color: '#5fd88f', label: 'M' },
}

const cache = new Map()

export function nodeIcon(network) {
  if (cache.has(network)) return cache.get(network)
  const { color, label } = NETWORK_STYLE[network] || { color: '#cccccc', label: '?' }
  const icon = L.divIcon({
    className: 'node-marker',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:50%;
      background:${color};color:#0b0b0d;font-weight:700;font-size:12px;
      border:2px solid #0b0b0d;box-shadow:0 1px 3px rgba(0,0,0,0.5);
    ">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  })
  cache.set(network, icon)
  return icon
}

export function pendingIcon() {
  return L.divIcon({
    className: 'pending-marker',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:20px;height:20px;border-radius:50%;
      background:#ffcf4d;border:2px dashed #0b0b0d;
    "></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}
