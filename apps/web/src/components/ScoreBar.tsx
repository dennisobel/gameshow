import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'motion/react'
import { FireIcon, LockSimpleIcon, XIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { PlayerId } from '@/game/machine'
import { PlayerAvatar } from './PlayerAvatar'
import { useNow } from '@/lib/hooks'
import { cn } from '@/lib/utils'

/** Counts up/down to `value` and pulses when it changes. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)
  const initial = useRef(value)
  useEffect(() => {
    const from = prev.current
    prev.current = value
    if (from === value) return
    const controls = animate(from, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => setDisplay(Math.round(v)) })
    return () => controls.stop()
  }, [value])
  return (
    <motion.span
      key={value}
      initial={value === initial.current ? false : { scale: 1.35 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', damping: 12, stiffness: 260 }}
      className={cn('inline-block tabular', className)}
    >
      {display}
    </motion.span>
  )
}

export type ChipStatus = 'idle' | 'locked' | 'struck' | 'winner' | 'thinking'

function PlayerChip({ player, status = 'idle', align }: { player: PlayerId; status?: ChipStatus; align: 'left' | 'right' }) {
  const { state } = useGame()
  const p = state.players[player]
  const delta = state.delta?.player === player ? state.delta : null
  const color = player === 0 ? 'var(--color-p1)' : 'var(--color-p2)'
  const right = align === 'right'
  const streakHot = p.streak >= 2

  return (
    <div
      className={cn(
        'relative flex min-w-0 items-center gap-2 rounded-2xl border bg-stage-800/80 px-2 py-1.5 transition-[border-color,box-shadow] duration-300',
        right && 'flex-row-reverse text-right',
        status === 'winner' ? 'shadow-[0_0_0_2px_var(--glow),0_0_24px_-4px_var(--glow)]' : '',
      )}
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, ['--glow' as string]: color }}
    >
      <PlayerAvatar player={player} variant={p.avatar} size={38} mood={status === 'struck' ? 'sad' : 'happy'} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[0.8rem] font-bold uppercase leading-none tracking-[0.14em]" style={{ color }}>
          {p.name}
        </p>
        <div className={cn('flex items-center gap-1.5', right && 'flex-row-reverse')}>
          <AnimatedNumber value={p.score} className="font-display text-[2rem] font-extrabold leading-none text-ink" />
          {status === 'locked' && <LockSimpleIcon size={16} weight="fill" className="text-gold" aria-label="Locked in" />}
          {status === 'struck' && (
            <span className="grid size-5 place-items-center rounded bg-wrong text-white" aria-label="Strike">
              <XIcon size={13} weight="bold" />
            </span>
          )}
          {status === 'thinking' && <span className="size-2 animate-bulb rounded-full" style={{ background: color }} aria-hidden="true" />}
        </div>
      </div>
      {streakHot && (
        <span
          className={cn(
            'absolute -top-2 inline-flex items-center gap-0.5 rounded-full bg-ember px-1.5 py-0.5 font-display text-[0.7rem] font-extrabold uppercase leading-none text-white shadow',
            right ? 'left-2' : 'right-2',
          )}
          aria-label={`${p.streak} answer streak`}
        >
          <FireIcon size={11} weight="fill" /> {p.streak}
        </span>
      )}
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.key}
            initial={{ opacity: 0, y: 8, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, -18, -26, -44], scale: [0.6, 1.2, 1, 1] }}
            transition={{ duration: 1.8, times: [0, 0.2, 0.7, 1] }}
            className={cn(
              'pointer-events-none absolute -top-3 font-display text-2xl font-extrabold italic text-gold drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]',
              right ? 'left-12' : 'right-12',
            )}
            aria-hidden="true"
          >
            +{delta.points}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

interface ScoreBarProps {
  status?: [ChipStatus, ChipStatus]
  center?: ReactNode
  className?: string
}

export function ScoreBar({ status = ['idle', 'idle'], center, className }: ScoreBarProps) {
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2', className)}>
      <PlayerChip player={0} status={status[0]} align="left" />
      <div className="grid min-w-10 place-items-center">
        {center ?? <span className="font-display text-lg font-extrabold italic text-ink-muted">VS</span>}
      </div>
      <PlayerChip player={1} status={status[1]} align="right" />
    </div>
  )
}

interface TimerProps {
  deadline: number
  duration: number
  frozenAt: number | null
  size?: number
}

/** Circular countdown. Ticks (sound + haptic) during the last five seconds. */
export function TimerRing({ deadline, duration, frozenAt, size = 58 }: TimerProps) {
  const { state, play, buzz } = useGame()
  const running = frozenAt === null && !state.paused
  const now = useNow(running, 100)
  const at = frozenAt ?? (state.paused ? state.pausedAt ?? now : now)
  const left = Math.max(0, deadline - at)
  const secs = Math.ceil(left / 1000)
  const frac = Math.min(1, left / duration)
  const urgent = secs <= 5 && left > 0
  const last = useRef(secs)

  useEffect(() => {
    if (secs !== last.current && running && secs <= 5 && secs > 0) {
      play(secs <= 3 ? 'tick' : 'tock')
      buzz('tick')
    }
    last.current = secs
  }, [secs, running, play, buzz])

  const r = 24
  const c = 2 * Math.PI * r
  return (
    <div className={cn('relative grid shrink-0 place-items-center', urgent && 'animate-bulb')} style={{ width: size, height: size }}>
      <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={30} cy={30} r={r} fill="var(--color-stage-950)" stroke="var(--color-stage-700)" strokeWidth={5} />
        <circle
          cx={30}
          cy={30}
          r={r}
          fill="none"
          stroke={urgent ? 'var(--color-wrong)' : 'var(--color-gold)'}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.2s' }}
        />
      </svg>
      <span
        role="timer"
        aria-label={`${secs} seconds left`}
        className={cn('relative font-display text-2xl font-extrabold tabular leading-none', urgent ? 'text-[#ff8f99]' : 'text-ink')}
      >
        {secs}
      </span>
    </div>
  )
}
