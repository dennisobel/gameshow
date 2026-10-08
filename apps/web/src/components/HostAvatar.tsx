import { useEffect, useId } from 'react'
import { motion, useAnimationControls } from 'motion/react'
import type { Mood } from '@/game/host'
import { cn } from '@/lib/utils'

const EYE = '#fff4d6'

interface Props {
  mood: Mood
  talking?: boolean
  size?: number
  /** Changes to this value replay the mood's reaction (bounce, head-shake...). */
  reactKey?: number
  glow?: boolean
  className?: string
}

const fillBox = { transformBox: 'fill-box', transformOrigin: 'center' } as const

function Eyes({ mood }: { mood: Mood }) {
  switch (mood) {
    case 'happy':
    case 'excited':
      return (
        <g stroke={EYE} strokeWidth={7} strokeLinecap="round" fill="none">
          <path d="M67 97 Q78 82 89 97" />
          <path d="M111 97 Q122 82 133 97" />
        </g>
      )
    case 'celebrate':
      return (
        <g fill="var(--color-gold)">
          {[78, 122].map((cx) => (
            <path
              key={cx}
              transform={`translate(${cx} 92)`}
              d="M0 -15 L4.4 -4.6 L15 -4.6 L6.6 2.2 L9.6 13 L0 6.6 L-9.6 13 L-6.6 2.2 L-15 -4.6 L-4.4 -4.6 Z"
            />
          ))}
        </g>
      )
    case 'surprised':
      return (
        <g fill={EYE}>
          <circle cx={78} cy={92} r={12} />
          <circle cx={122} cy={92} r={12} />
          <g stroke={EYE} strokeWidth={4} strokeLinecap="round" fill="none">
            <path d="M64 70 Q77 61 90 70" />
            <path d="M110 70 Q123 61 136 70" />
          </g>
        </g>
      )
    case 'sad':
      return (
        <g fill={EYE}>
          <rect x={71} y={86} width={14} height={18} rx={7} />
          <rect x={115} y={86} width={14} height={18} rx={7} />
          <g stroke={EYE} strokeWidth={4} strokeLinecap="round">
            <path d="M64 80 L88 72" />
            <path d="M136 80 L112 72" />
          </g>
        </g>
      )
    case 'thinking':
      return (
        <g fill={EYE}>
          <rect x={76} y={78} width={14} height={24} rx={7} />
          <rect x={120} y={78} width={14} height={24} rx={7} />
          <g stroke={EYE} strokeWidth={4} strokeLinecap="round" fill="none">
            <path d="M68 70 Q80 61 92 69" />
            <path d="M114 72 L136 72" />
          </g>
        </g>
      )
    case 'smug':
      return (
        <g>
          <rect x={70} y={90} width={16} height={11} rx={5.5} fill={EYE} />
          <rect x={114} y={90} width={16} height={11} rx={5.5} fill={EYE} />
          <g stroke={EYE} strokeWidth={4} strokeLinecap="round">
            <path d="M66 86 L90 86" />
            <path d="M110 86 L134 86" />
          </g>
        </g>
      )
    default:
      return (
        <g fill={EYE}>
          <rect x={71} y={79} width={14} height={26} rx={7} />
          <rect x={115} y={79} width={14} height={26} rx={7} />
        </g>
      )
  }
}

function Mouth({ mood, talking }: { mood: Mood; talking: boolean }) {
  const grin = mood === 'happy' || mood === 'excited' || mood === 'celebrate'
  if (talking && mood !== 'surprised') {
    return grin ? (
      <path d="M80 112 Q100 142 120 112 Z" fill={EYE} className="animate-speak" style={fillBox} />
    ) : (
      <ellipse cx={100} cy={121} rx={12} ry={9} fill={EYE} className="animate-speak" style={fillBox} />
    )
  }
  switch (mood) {
    case 'happy':
      return <path d="M80 112 Q100 140 120 112 Z" fill={EYE} />
    case 'excited':
    case 'celebrate':
      return <path d="M76 109 Q100 150 124 109 Z" fill={EYE} />
    case 'surprised':
      return <ellipse cx={100} cy={124} rx={9} ry={11} fill={EYE} />
    case 'sad':
      return <path d="M86 128 Q100 115 114 128" stroke={EYE} strokeWidth={6} strokeLinecap="round" fill="none" />
    case 'thinking':
      return <path d="M90 123 L113 118" stroke={EYE} strokeWidth={6} strokeLinecap="round" />
    case 'smug':
      return <path d="M84 120 Q102 130 118 113" stroke={EYE} strokeWidth={6} strokeLinecap="round" fill="none" />
    default:
      return <path d="M84 116 Q100 131 116 116" stroke={EYE} strokeWidth={6} strokeLinecap="round" fill="none" />
  }
}

/**
 * Nova — the AI host. A stylised TV-head with a headset mic and a gold bow tie.
 * Expressions are swapped per mood; the mouth animates while the host talks.
 */
export function HostAvatar({ mood, talking = false, size = 120, reactKey, glow = true, className }: Props) {
  const id = useId().replace(/:/g, '')
  const controls = useAnimationControls()

  useEffect(() => {
    if (reactKey === undefined) return
    if (mood === 'happy' || mood === 'excited' || mood === 'celebrate') {
      void controls.start({ y: [0, -16, 0, -6, 0], rotate: 0, scale: 1, transition: { duration: 0.7, ease: 'easeOut' } })
    } else if (mood === 'sad') {
      void controls.start({ rotate: [0, -9, 8, -6, 4, 0], y: 0, scale: 1, transition: { duration: 0.8 } })
    } else if (mood === 'surprised') {
      void controls.start({ scale: [1, 1.12, 0.98, 1], y: 0, rotate: 0, transition: { duration: 0.5 } })
    } else if (mood === 'thinking') {
      void controls.start({ rotate: [0, 6, 6, 0], y: 0, scale: 1, transition: { duration: 1.4 } })
    }
  }, [reactKey, mood, controls])

  const cheeks = mood === 'happy' || mood === 'excited' || mood === 'celebrate'

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} aria-hidden="true">
      {glow && (
        <div
          className="absolute inset-[8%] rounded-full blur-2xl"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--color-host) 55%, transparent), transparent 70%)' }}
        />
      )}
      <motion.div animate={controls} className="relative h-full w-full">
        <div className="h-full w-full animate-float">
          <svg viewBox="0 0 200 200" width="100%" height="100%" className="overflow-visible">
            <defs>
              <linearGradient id={`shell-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#c3b0ff" />
                <stop offset="0.45" stopColor="#8b6bff" />
                <stop offset="1" stopColor="#4f33c9" />
              </linearGradient>
              <radialGradient id={`screen-${id}`} cx="0.5" cy="0.35" r="0.8">
                <stop offset="0" stopColor="#231a63" />
                <stop offset="1" stopColor="#0c0926" />
              </radialGradient>
              <linearGradient id={`tie-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffe39a" />
                <stop offset="1" stopColor="#e08a00" />
              </linearGradient>
              <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* antenna */}
            <path d="M100 42 L100 20" stroke="#b9a6ff" strokeWidth={5} strokeLinecap="round" />
            <circle
              cx={100}
              cy={15}
              r={8}
              fill="var(--color-gold)"
              filter={`url(#glow-${id})`}
              className={talking ? 'animate-bulb' : undefined}
            />

            {/* side knobs */}
            <rect x={18} y={82} width={14} height={36} rx={6} fill="#4f33c9" />
            <rect x={168} y={82} width={14} height={36} rx={6} fill="#4f33c9" />

            {/* head */}
            <rect x={28} y={40} width={144} height={114} rx={42} fill={`url(#shell-${id})`} />
            <path d="M60 46 Q100 38 140 46" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={4} strokeLinecap="round" fill="none" />

            {/* screen face */}
            <rect x={43} y={55} width={114} height={86} rx={32} fill={`url(#screen-${id})`} />
            <path d="M56 76 Q62 64 80 61" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={5} strokeLinecap="round" fill="none" />

            {cheeks && (
              <g fill="#ff7ab8" opacity={0.5}>
                <ellipse cx={60} cy={116} rx={9} ry={5} />
                <ellipse cx={140} cy={116} rx={9} ry={5} />
              </g>
            )}

            <g filter={`url(#glow-${id})`}>
              <g className="animate-blink" style={fillBox}>
                <Eyes mood={mood} />
              </g>
              <Mouth mood={mood} talking={talking} />
            </g>

            {/* headset mic */}
            <path d="M178 104 C 192 150, 160 168, 128 156" stroke="#2a2170" strokeWidth={5} strokeLinecap="round" fill="none" />
            <rect x={116} y={149} width={16} height={12} rx={6} fill="#2a2170" />
            <circle cx={121} cy={155} r={2.5} fill="var(--color-gold)" />

            {/* bow tie */}
            <g transform="translate(100 176)">
              <path d="M0 0 L-24 -11 L-24 11 Z" fill={`url(#tie-${id})`} />
              <path d="M0 0 L24 -11 L24 11 Z" fill={`url(#tie-${id})`} />
              <rect x={-7} y={-7} width={14} height={14} rx={4} fill="#ffc940" stroke="#b86e00" strokeWidth={2} />
            </g>
          </svg>
        </div>
      </motion.div>
    </div>
  )
}
