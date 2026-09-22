import L from 'leaflet'

const NETWORK_STYLE = {
  meshcore: { color: '#3aa0ff', label: 'C' },
  meshtastic: { color: '#5fd88f', label: 'M' },
}

const cache = new Map()

export function nodeIcon(network, source = 'manual') {
  const cacheKey = `${network}:${source}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const { color, label } = NETWORK_STYLE[network] || { color: '#cccccc', label: '?' }
  const border = source === 'live' ? '2px dashed #f2f2f2' : '2px solid #0b0b0d'
  const icon = L.divIcon({
    className: 'node-marker',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:50%;
      background:${color};color:#0b0b0d;font-weight:700;font-size:12px;
      border:${border};box-shadow:0 1px 3px rgba(0,0,0,0.5);
    ">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  })
  cache.set(cacheKey, icon)
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
