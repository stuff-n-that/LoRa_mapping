export function kmToMiles(km) {
  return km * 0.621371
}

// "12.34 km / 7.67 mi"-style label for the measure tools — precision drops
// as the number grows so a 9,000km line doesn't read as "9123.47 km".
export function formatDistance(km) {
  const mi = kmToMiles(km)
  const fmt = (n) => {
    if (n < 10) return n.toFixed(2)
    if (n < 100) return n.toFixed(1)
    return Math.round(n).toLocaleString()
  }
  return `${fmt(km)} km / ${fmt(mi)} mi`
}

export function formatAgo(dateLike) {
  if (!dateLike) return ''
  const then = dateLike instanceof Date ? dateLike.getTime() : new Date(dateLike).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}
