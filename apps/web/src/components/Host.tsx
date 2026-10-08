import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useGame } from '@/game/GameContext'
import { HOST_NAME } from '@/game/questions'
import { HostAvatar } from './HostAvatar'
import { cn } from '@/lib/utils'

function useTypewriter(text: string, key: number, instant: boolean) {
  const [count, setCount] = useState(instant ? text.length : 0)
  useEffect(() => {
    if (instant) {
      setCount(text.length)
      return
    }
    setCount(0)
    let i = 0
    const id = window.setInterval(() => {
      i += 2
      setCount(Math.min(i, text.length))
      if (i >= text.length) window.clearInterval(id)
    }, 38)
    return () => window.clearInterval(id)
  }, [text, key, instant])
  return count
}

function VoiceBars() {
  return (
    <span className="inline-flex h-4 items-end gap-0.5" aria-hidden="true">
      {[0.6, 1, 0.75, 0.9].map((h, i) => (
        <span key={i} className="w-1 animate-speak rounded-full bg-host" style={{ height: `${h * 100}%`, animationDelay: `${i * 0.08}s` }} />
      ))}
    </span>
  )
}

type Tail = 'left' | 'top' | 'none'

/** Host speech bubble. Captions type on; the full line is always announced to screen readers. */
export function HostCaption({ size = 'md', tail = 'left', className }: { size?: 'sm' | 'md' | 'lg'; tail?: Tail; className?: string }) {
  const { line, state, settings, talking } = useGame()
  const count = useTypewriter(line, state.host.key, settings.reduceMotion)
  const text = { sm: 'text-[0.95rem]', md: 'text-[1.05rem]', lg: 'text-xl' }[size]

  return (
    <div
      className={cn(
        'relative rounded-3xl border border-host/35 bg-stage-800/90 px-4 py-2.5 shadow-[0_10px_30px_-12px_rgba(91,63,217,0.6)] backdrop-blur',
        className,
      )}
    >
      {tail === 'left' && (
        <span className="absolute -left-[7px] top-5 size-3.5 rotate-45 border-b border-l border-host/35 bg-stage-800" aria-hidden="true" />
      )}
      {tail === 'top' && (
        <span className="absolute -top-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 border-l border-t border-host/35 bg-stage-800" aria-hidden="true" />
      )}
      <p className="mb-0.5 flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.2em] text-host">
        <span className={cn('size-1.5 rounded-full bg-host', talking && 'animate-bulb')} aria-hidden="true" />
        {HOST_NAME} · AI Host
        {talking && !settings.captions && <VoiceBars />}
      </p>
      <p className="sr-only" aria-live="polite">
        {HOST_NAME} says: {line}
      </p>
      {settings.captions ? (
        <p className={cn('font-extrabold leading-snug text-ink text-balance', text)} aria-hidden="true">
          {line.slice(0, count)}
          <span className="opacity-0">{line.slice(count)}</span>
        </p>
      ) : (
        <p className="text-sm font-semibold italic text-ink-muted" aria-hidden="true">
          Captions off
        </p>
      )}
    </div>
  )
}

interface HostBlockProps {
  layout?: 'row' | 'stage'
  avatar?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Host avatar + caption. `row` for in-game, `stage` for big announcements. */
export function HostBlock({ layout = 'row', avatar = 64, size = 'md', className }: HostBlockProps) {
  const { state, talking } = useGame()
  if (layout === 'stage') {
    return (
      <div className={cn('flex flex-col items-center gap-3', className)}>
        <motion.div layout transition={{ type: 'spring', damping: 24, stiffness: 220 }}>
          <HostAvatar mood={state.host.mood} talking={talking} size={avatar} reactKey={state.host.key} />
        </motion.div>
        <HostCaption size={size} tail="top" className="w-full max-w-sm text-center" />
      </div>
    )
  }
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <motion.div layout transition={{ type: 'spring', damping: 24, stiffness: 220 }} className="-mt-1">
        <HostAvatar mood={state.host.mood} talking={talking} size={avatar} reactKey={state.host.key} glow={avatar > 60} />
      </motion.div>
      <HostCaption size={size} className="min-w-0 flex-1" />
    </div>
  )
}
