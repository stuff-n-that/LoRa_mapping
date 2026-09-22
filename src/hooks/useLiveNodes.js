import { useEffect, useRef, useState } from 'react'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000 // be a polite citizen of someone else's public API

export function useLiveNodes(fetcher, { enabled, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const [nodes, setNodes] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      setNodes([])
      setError('')
      return
    }

    const controller = new AbortController()
    let cancelled = false

    async function load() {
      setStatus('loading')
      try {
        const result = await fetcher({ signal: controller.signal })
        if (cancelled) return
        setNodes(result)
        setStatus('ready')
        setError('')
        setUpdatedAt(new Date())
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        setStatus('error')
        setError(err.message || 'Failed to fetch live data')
      }
    }

    load()
    const timer = setInterval(load, intervalMs)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [enabled, intervalMs, fetcher, refreshToken])

  function refresh() {
    setRefreshToken((n) => n + 1)
  }

  return { nodes, status, error, updatedAt, refresh }
}
