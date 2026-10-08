import { useEffect, useState } from 'react'

/** Current time, refreshed on an interval while `active`. */
export function useNow(active = true, interval = 100) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(id)
  }, [active, interval])
  return now
}
