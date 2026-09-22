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
