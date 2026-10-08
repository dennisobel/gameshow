import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { HandsClappingIcon, XIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { useNow } from '@/lib/hooks'
import { cn } from '@/lib/utils'

/* ----------------------------- countdown ----------------------------- */

const STEPS = ['3', '2', '1', 'GO!']

/** `duration` is how long the server gave the countdown, so the digits keep its pace. */
export function CountdownOverlay({ phaseStart, duration }: { phaseStart: number; duration: number }) {
  const { play, buzz, state } = useGame()
  const now = useNow(!state.paused, 50)
  const step = Math.min(STEPS.length - 1, Math.floor((now - phaseStart) / (duration / 4)))
  const shown = Math.max(0, step)
  const last = useRef(-1)

  useEffect(() => {
    if (shown === last.current) return
    last.current = shown
    if (shown < 3) {
      play('count')
      buzz('tick')
    } else {
      play('go')
      buzz('go')
    }
  }, [shown, play, buzz])

  const go = shown === 3
  return (
    <motion.div
      className="absolute inset-0 z-30 grid place-items-center bg-stage-950/55 backdrop-blur-[3px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      <div className="relative grid place-items-center" role="status" aria-live="assertive">
        <p className="absolute -top-16 font-display text-lg font-bold uppercase tracking-[0.3em] text-ink-soft">Face-off</p>
        <span className="absolute size-44 animate-pulse-ring rounded-full border-4 border-gold/60" aria-hidden="true" />
        <AnimatePresence mode="popLayout">
          <motion.span
            key={shown}
            initial={{ scale: 2.4, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ type: 'spring', damping: 14, stiffness: 260 }}
            className={cn(
              'block font-display font-black italic leading-none drop-shadow-[0_8px_0_rgba(0,0,0,0.45)]',
              go ? 'gold-text text-[7.5rem]' : 'text-[10rem] text-ink',
            )}
          >
            {STEPS[shown]}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/* ------------------------------- strike ------------------------------ */

export function StrikeOverlay({ label = 'Not on the board' }: { label?: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
      initial={{ opacity: 1 }}
      animate={{ opacity: [1, 1, 0] }}
      transition={{ duration: 1.5, times: [0, 0.75, 1] }}
      role="alert"
    >
      <motion.div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 45%, rgba(255,77,94,0.05), rgba(255,77,94,0.55))' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6] }}
        transition={{ duration: 0.5 }}
      />
      <div className="relative flex flex-col items-center gap-3">
        <motion.div
          initial={{ scale: 3, rotate: -25, opacity: 0 }}
          animate={{ scale: 1, rotate: -6, opacity: 1 }}
          transition={{ type: 'spring', damping: 11, stiffness: 320 }}
          className="grid size-36 place-items-center rounded-[36px] border-4 border-white/80 bg-wrong text-white shadow-[0_0_60px_10px_rgba(255,77,94,0.6)]"
        >
          <XIcon size={104} weight="bold" />
        </motion.div>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="font-display text-4xl font-black uppercase italic text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]"
        >
          ✕ Strike!
        </motion.p>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="rounded-full bg-stage-950/80 px-4 py-1 font-display text-lg font-bold uppercase tracking-[0.18em] text-[#ffb3ba]"
        >
          {label}
        </motion.p>
      </div>
    </motion.div>
  )
}

/* ------------------------- audience + reactions ------------------------ */

const AUDIENCE_COPY: Record<string, string> = { cheer: 'WOOO!', ooh: 'OOOOHHH!', gasp: 'OHHH!' }

export function AudienceLayer() {
  const { audience } = useGame()
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
      {audience.map((a, i) => (
        <div key={a.id} className="absolute bottom-40 animate-rise" style={{ [i % 2 ? 'right' : 'left']: `${8 + (a.id % 3) * 6}%` }}>
          <span className="flex items-center gap-1 rounded-full bg-stage-950/70 px-3 py-1 font-display text-2xl font-black italic text-gold shadow-lg">
            {a.kind === 'cheer' && <HandsClappingIcon size={22} weight="fill" />}
            {AUDIENCE_COPY[a.kind] ?? a.kind}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ReactionLayer() {
  const { reactions, state } = useGame()
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden" aria-live="polite">
      {reactions.map((r) => {
        const emoji = r.content.length <= 2
        const color = r.player === 0 ? 'var(--color-p1)' : 'var(--color-p2)'
        return (
          <div
            key={r.id}
            className="absolute bottom-44 animate-rise"
            style={{ [r.player === 0 ? 'left' : 'right']: `${10 + (r.id % 4) * 5}%` }}
          >
            <span className="sr-only">
              {state.players[r.player].name} sent {r.content}
            </span>
            {emoji ? (
              <span className="text-5xl drop-shadow-lg" aria-hidden="true">
                {r.content}
              </span>
            ) : (
              <span
                className="block rounded-2xl border-2 bg-stage-900 px-3 py-1.5 font-display text-xl font-extrabold uppercase italic text-ink shadow-lg"
                style={{ borderColor: color }}
                aria-hidden="true"
              >
                {r.content}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------- toast ------------------------------- */

export function Toast() {
  const { toast } = useGame()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center px-6" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: -16, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, transition: { duration: 0.15 } }}
            className="rounded-full border border-white/10 bg-stage-700 px-4 py-2 text-center text-sm font-bold text-ink shadow-xl"
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------ confetti ------------------------------ */

export function Confetti({ run }: { run: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { settings } = useGame()
  useEffect(() => {
    const canvas = ref.current
    if (!run || !canvas || settings.reduceMotion) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)
    const colors = ['#ffc940', '#ff4fa3', '#2fd6ff', '#9b7bff', '#3be38b', '#ffffff']
    const parts = Array.from({ length: 140 }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 80,
      y: height * 0.35,
      vx: (Math.random() - 0.5) * 11,
      vy: -Math.random() * 13 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      c: colors[Math.floor(Math.random() * colors.length)],
    }))
    let frame = 0
    let raf = 0
    const draw = () => {
      frame += 1
      ctx.clearRect(0, 0, width, height)
      for (const p of parts) {
        p.vy += 0.28
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.c
        ctx.globalAlpha = Math.max(0, 1 - frame / 240)
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)))
        ctx.restore()
      }
      if (frame < 240) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [run, settings.reduceMotion])
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden="true" />
}
