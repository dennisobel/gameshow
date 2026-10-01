import { useEffect, useRef, useState } from 'react'

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

/** Returns a click handler that fires `onTriple` after three quick taps. */
export function useTripleTap(onTriple: () => void) {
  const taps = useRef<number[]>([])
  return () => {
    const t = Date.now()
    taps.current = [...taps.current.filter((x) => t - x < 700), t]
    if (taps.current.length >= 3) {
      taps.current = []
      onTriple()
    }
  }
}
