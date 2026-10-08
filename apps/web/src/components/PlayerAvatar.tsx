import { useId } from 'react'
import type { PlayerId } from '@/game/machine'
import { cn } from '@/lib/utils'

export const AVATAR_NAMES = ['Sprout', 'Whiskers', 'Beacon', 'DJ', 'Royal', 'Rookie']

const TINTS: Record<PlayerId, [string, string, string]> = {
  0: ['#ffc2de', '#ff4fa3', '#a3155f'],
  1: ['#c4f4ff', '#2fd6ff', '#0a6f94'],
}

function Accessory({ variant, deep, grad }: { variant: number; deep: string; grad: string }) {
  switch (variant) {
    case 1: // cat ears
      return (
        <g fill={grad}>
          <path d="M22 40 L26 10 L46 26 Z" />
          <path d="M78 40 L74 10 L54 26 Z" />
        </g>
      )
    case 2: // antenna
      return (
        <g>
          <path d="M50 22 L50 8" stroke={deep} strokeWidth={4} strokeLinecap="round" />
          <circle cx={50} cy={7} r={5} fill="var(--color-gold)" />
        </g>
      )
    case 3: // headphones
      return (
        <g>
          <path d="M16 56 Q16 14 50 14 Q84 14 84 56" stroke="#1a1646" strokeWidth={7} fill="none" strokeLinecap="round" />
          <rect x={8} y={46} width={14} height={24} rx={6} fill="#1a1646" />
          <rect x={78} y={46} width={14} height={24} rx={6} fill="#1a1646" />
        </g>
      )
    case 4: // crown
      return <path d="M30 26 L34 6 L43 18 L50 2 L57 18 L66 6 L70 26 Z" fill="var(--color-gold)" stroke="#b86e00" strokeWidth={2} strokeLinejoin="round" />
    case 5: // cap
      return (
        <g fill={deep}>
          <path d="M18 44 Q18 14 50 14 Q82 14 82 44 Z" />
          <path d="M60 40 Q84 38 96 46 Q86 50 64 48 Z" />
        </g>
      )
    default: // tuft
      return <path d="M42 24 Q44 6 58 12 Q50 14 54 24" fill={deep} />
  }
}

interface Props {
  player: PlayerId
  variant: number
  size?: number
  className?: string
  mood?: 'happy' | 'sad' | 'neutral'
  label?: string
}

export function PlayerAvatar({ player, variant, size = 48, className, mood = 'happy', label }: Props) {
  const id = useId().replace(/:/g, '')
  const [light, mid, deep] = TINTS[player]
  const grad = `url(#pa-${id})`
  const front = variant >= 2
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('shrink-0 overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={`pa-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.55" stopColor={mid} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      {!front && <Accessory variant={variant} deep={deep} grad={grad} />}
      <circle cx={50} cy={56} r={34} fill={grad} />
      <ellipse cx={40} cy={40} rx={10} ry={6} fill="#ffffff" opacity={0.25} />
      {front && <Accessory variant={variant} deep={deep} grad={grad} />}
      <g fill="#0d0b29">
        <ellipse cx={39} cy={55} rx={4} ry={5.5} />
        <ellipse cx={61} cy={55} rx={4} ry={5.5} />
      </g>
      {mood === 'sad' ? (
        <path d="M41 72 Q50 64 59 72" stroke="#0d0b29" strokeWidth={4} strokeLinecap="round" fill="none" />
      ) : mood === 'neutral' ? (
        <path d="M42 69 L58 69" stroke="#0d0b29" strokeWidth={4} strokeLinecap="round" />
      ) : (
        <path d="M40 66 Q50 76 60 66" stroke="#0d0b29" strokeWidth={4} strokeLinecap="round" fill="none" />
      )}
    </svg>
  )
}
