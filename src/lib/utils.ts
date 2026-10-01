import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const HAPTICS: Record<string, number | number[]> = {
  tap: 8,
  tick: 6,
  go: [20, 40, 20],
  lock: 25,
  correct: [30, 40, 60],
  wrong: [140, 60, 140],
  win: [40, 50, 40, 50, 220],
}

export function vibrate(name: string) {
  try {
    navigator.vibrate?.(HAPTICS[name] ?? 10)
  } catch {
    /* unsupported */
  }
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `00:${String(s).padStart(2, '0')}`
}
