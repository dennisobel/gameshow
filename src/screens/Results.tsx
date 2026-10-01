import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  CrownIcon,
  FireIcon,
  HouseIcon,
  LightningIcon,
  ShareNetworkIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { PlayerId } from '@/game/machine'
import { ROUNDS } from '@/game/questions'
import { HostBlock } from '@/components/Host'
import { HostAvatar } from '@/components/HostAvatar'
import { HostCaption } from '@/components/Host'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { AnimatedNumber } from '@/components/ScoreBar'
import { Confetti } from '@/components/Overlays'
import { ReactionBar } from '@/components/ReactionBar'
import { Eyebrow, Marquee, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const colorOf = (p: PlayerId) => (p === 0 ? 'var(--color-p1)' : 'var(--color-p2)')

/* ---------------------------- round result ---------------------------- */

export function RoundResult() {
  const { state, act } = useGame()
  const rec = state.history.at(-1)
  const w = rec?.winner ?? null
  const final = state.roundIndex >= ROUNDS.length - 1
  // Show the old score first, then count up to the new one.
  const [shown, setShown] = useState(w !== null ? state.players[w].score - (rec?.points ?? 0) : 0)
  useEffect(() => {
    if (w === null) return
    const id = window.setTimeout(() => setShown(state.players[w].score), 650)
    return () => window.clearTimeout(id)
  }, [w, state.players])

  const others = ([0, 1] as PlayerId[]).filter((p) => p !== w)

  return (
    <ScreenShell>
      <TopBar left={<span />} title={<Eyebrow className="text-ink-soft">Round {rec?.number ?? state.roundIndex + 1} complete</Eyebrow>} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {w !== null && rec ? (
          <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14 }} className="flex flex-col items-center">
            <div className="relative">
              <span className="absolute inset-0 animate-pulse-ring rounded-full border-4" style={{ borderColor: colorOf(w) }} aria-hidden="true" />
              <PlayerAvatar player={w} variant={state.players[w].avatar} size={96} />
            </div>
            <p className="mt-2 font-display text-5xl font-black uppercase italic leading-none" style={{ color: colorOf(w) }}>
              {state.players[w].name}
            </p>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-ink-muted">
              {rec.stolen ? 'Stole it with' : 'Won with'} “{rec.answer}”
            </p>
            <motion.p
              initial={{ y: 10, opacity: 0, scale: 0.6 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: 0.35, type: 'spring', damping: 10 }}
              className="mt-1 font-display text-5xl font-black italic text-gold"
            >
              +{rec.points}
            </motion.p>
            <AnimatedNumber value={shown} className="font-display text-[5.5rem] font-black leading-[0.9] text-ink" />
          </motion.div>
        ) : (
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <p className="font-display text-5xl font-black uppercase italic leading-none text-ink">Nobody scored</p>
            <p className="mt-1 font-bold text-ink-muted">The board wins this round.</p>
          </motion.div>
        )}

        <div className="my-1 h-px w-2/3 bg-linear-to-r from-transparent via-white/20 to-transparent" aria-hidden="true" />

        <div className="flex gap-6">
          {others.map((p) => (
            <div key={p} className="flex items-center gap-2.5">
              <PlayerAvatar player={p} variant={state.players[p].avatar} size={40} mood={w === null ? 'neutral' : 'sad'} />
              <div className="text-left">
                <p className="font-display text-lg font-extrabold uppercase tracking-wider" style={{ color: colorOf(p) }}>
                  {state.players[p].name}
                </p>
                <p className="font-display text-3xl font-black leading-none tabular">{state.players[p].score}</p>
              </div>
            </div>
          ))}
        </div>

        <HostBlock avatar={64} size="md" className="mt-2 w-full text-left" />
        <ReactionBar className="w-full" />
      </div>
      <Button size="xl" block className="mt-3" onClick={() => act({ type: 'AFTER_RESULT' })}>
        {final ? 'Final results' : 'Next round'} <ArrowRightIcon size={24} weight="bold" />
      </Button>
    </ScreenShell>
  )
}

/* ------------------------------ scoreboard ------------------------------ */

export function Scoreboard() {
  const { state, act, talking } = useGame()
  const order = ([0, 1] as PlayerId[]).sort((a, b) => state.players[b].score - state.players[a].score)
  const tie = state.players[0].score === state.players[1].score
  const next = ROUNDS[state.roundIndex + 1]
  const nextNumber = state.roundIndex + 2
  const max = Math.max(1, ...state.players.map((p) => p.score))

  return (
    <ScreenShell>
      <Marquee />
      <TopBar left={<span />} />
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <div className="w-full">
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-1 flex-1 rounded-full bg-linear-to-r from-transparent to-gold" />
            <span className="h-1 w-3 rounded-full bg-gold" />
            <span className="h-1 flex-1 rounded-full bg-linear-to-l from-transparent to-gold" />
          </div>
          <h1 className="my-2 text-center font-display text-4xl font-black uppercase italic tracking-[0.12em] text-ink">Scoreboard</h1>
          <ol className="flex flex-col gap-2">
            {order.map((p, i) => (
              <motion.li
                key={p}
                initial={{ x: i ? 40 : -40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.12, type: 'spring', damping: 18 }}
                className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-stage-800/80 px-3 py-2.5"
              >
                <motion.span
                  className="absolute inset-y-0 left-0 opacity-20"
                  style={{ background: colorOf(p) }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(state.players[p].score / max) * 100}%` }}
                  transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
                  aria-hidden="true"
                />
                <PlayerAvatar player={p} variant={state.players[p].avatar} size={44} />
                <span className="relative flex-1 font-display text-2xl font-black uppercase italic" style={{ color: colorOf(p) }}>
                  {state.players[p].name}
                </span>
                {i === 0 && !tie && <CrownIcon size={22} weight="fill" className="relative text-gold" aria-label="Leader" />}
                <span className="relative font-display text-5xl font-black leading-none tabular text-ink">{state.players[p].score}</span>
              </motion.li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-2" aria-label="Round history">
          {ROUNDS.map((def, i) => {
            const rec = state.history.find((h) => h.number === i + 1 && h.kind !== 'sudden')
            const isNext = i === state.roundIndex + 1
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-full border-2 font-display text-base font-extrabold',
                    rec?.winner === 0 && 'border-p1 bg-p1 text-stage-950',
                    rec?.winner === 1 && 'border-p2 bg-p2 text-stage-950',
                    rec && rec.winner === null && 'border-stage-500 bg-stage-700 text-ink-muted',
                    !rec && (isNext ? 'border-gold text-gold' : 'border-stage-600 text-ink-muted'),
                  )}
                  aria-label={
                    rec
                      ? `Round ${i + 1}: ${rec.winner === null ? 'nobody' : state.players[rec.winner].name}`
                      : `Round ${i + 1}: ${isNext ? 'up next' : 'to play'}`
                  }
                >
                  {rec ? (rec.winner === null ? '–' : state.players[rec.winner].name[0].toUpperCase()) : def.kind === 'final' ? <FireIcon size={18} weight="fill" /> : i + 1}
                </span>
                <span className="text-[0.65rem] font-bold uppercase tracking-wider text-ink-muted">R{i + 1}</span>
              </div>
            )
          })}
        </div>

        <div className="flex w-full flex-col items-center gap-2">
          <HostAvatar mood={state.host.mood} talking={talking} size={104} reactKey={state.host.key} />
          <HostCaption size="lg" tail="top" className="w-full text-center" />
        </div>

        {next && (
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-stage-800/70 px-3 py-1.5 font-display text-base font-bold uppercase tracking-[0.14em] text-ink-soft">
            Up next · Round {nextNumber}
            {next.kind === 'double' && (
              <span className="inline-flex items-center gap-1 text-host">
                <LightningIcon size={14} weight="fill" /> Double points
              </span>
            )}
            {next.kind === 'final' && (
              <span className="inline-flex items-center gap-1 text-ember">
                <FireIcon size={14} weight="fill" /> Final ×3
              </span>
            )}
          </p>
        )}
      </div>
      <Button size="xl" block className="mt-3" onClick={() => act({ type: 'AFTER_SCOREBOARD' })}>
        Continue <ArrowRightIcon size={24} weight="bold" />
      </Button>
    </ScreenShell>
  )
}

/* -------------------------------- result -------------------------------- */

export function resultQuote(state: ReturnType<typeof useGame>['state'], winner: PlayerId) {
  const [a, b] = state.players
  const margin = Math.abs(a.score - b.score)
  const finalRec = state.history.find((h) => h.kind === 'final')
  if (state.history.some((h) => h.kind === 'sudden' && h.winner === winner)) return 'Won it in sudden death.'
  if (finalRec?.winner === winner) return 'I survived the final round.'
  if (state.history.some((h) => h.stolen && h.winner === winner)) return 'Stole it when it mattered.'
  if (margin >= 20) return 'Never in doubt.'
  return 'Close one. Still mine.'
}

function Scores({ first }: { first: PlayerId }) {
  const { state } = useGame()
  const second: PlayerId = first === 0 ? 1 : 0
  return (
    <div className="flex flex-col items-center">
      <p className="font-display text-6xl font-black uppercase italic leading-none" style={{ color: colorOf(first) }}>
        {state.players[first].name}
      </p>
      <p className="font-display text-[6rem] font-black leading-[0.9] tabular text-ink">{state.players[first].score}</p>
      <div className="mt-1 flex items-center gap-2 rounded-full bg-stage-800/80 px-3 py-1">
        <PlayerAvatar player={second} variant={state.players[second].avatar} size={28} mood="neutral" />
        <span className="font-display text-lg font-extrabold uppercase tracking-wider" style={{ color: colorOf(second) }}>
          {state.players[second].name}
        </span>
        <span className="font-display text-2xl font-black tabular text-ink-soft">{state.players[second].score}</span>
      </div>
    </div>
  )
}

export function Result() {
  const { state, act, setOverlay, talking } = useGame()
  const outcome = state.outcome
  const humans = ([0, 1] as PlayerId[]).filter((p) => state.controllers[p] === 'human')
  const loserView = outcome !== 'draw' && outcome !== null && humans.length === 1 && humans[0] !== outcome
  const win = outcome !== 'draw' && outcome !== null && !loserView

  const actions = (
    <div className="flex flex-col gap-3">
      <Button size="xl" block className="animate-glow" onClick={() => act({ type: 'REMATCH' })}>
        <ArrowCounterClockwiseIcon size={24} weight="bold" /> {loserView ? 'Rematch' : 'Play again'}
      </Button>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" size="md" onClick={() => setOverlay('share')} disabled={outcome === 'draw'}>
          <ShareNetworkIcon size={20} weight="bold" /> Share result
        </Button>
        <Button variant="outline" size="md" onClick={() => act({ type: 'NAV', screen: 'setup' })}>
          <UsersIcon size={20} weight="bold" /> New players
        </Button>
      </div>
    </div>
  )

  const top = (
    <TopBar
      left={
        <IconButton label="Home" onClick={() => act({ type: 'NAV', screen: 'home' })}>
          <HouseIcon size={22} weight="bold" />
        </IconButton>
      }
    />
  )

  if (outcome === 'draw' || outcome === null) {
    return (
      <ScreenShell>
        {top}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <HostAvatar mood="surprised" talking={talking} size={140} reactKey={state.host.key} />
          <h1 className="font-display text-6xl font-black uppercase italic leading-none text-ink">It's a draw</h1>
          <div className="flex gap-8">
            {([0, 1] as PlayerId[]).map((p) => (
              <div key={p} className="flex flex-col items-center">
                <PlayerAvatar player={p} variant={state.players[p].avatar} size={52} />
                <span className="font-display text-lg font-extrabold uppercase" style={{ color: colorOf(p) }}>
                  {state.players[p].name}
                </span>
                <span className="font-display text-5xl font-black tabular">{state.players[p].score}</span>
              </div>
            ))}
          </div>
          <HostCaption size="lg" tail="none" className="w-full text-center" />
        </div>
        {actions}
      </ScreenShell>
    )
  }

  if (loserView) {
    const me = humans[0]
    const roundsWon = state.history.filter((h) => h.winner === me).length
    return (
      <ScreenShell>
        {top}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">Final score</p>
          <h1 className="font-display text-6xl font-black uppercase italic leading-none text-ink">Good game.</h1>
          <Scores first={outcome} />
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-stage-800/70 px-3 py-2">
            <PlayerAvatar player={me} variant={state.players[me].avatar} size={36} />
            <p className="text-sm font-bold text-ink-soft">
              You scored <span className="text-ink">{state.players[me].score}</span> — {roundsWon} {roundsWon === 1 ? 'round' : 'rounds'} won.
            </p>
          </div>
          <div className="flex w-full items-start gap-2 text-left">
            <HostAvatar mood={state.host.mood} talking={talking} size={80} reactKey={state.host.key} />
            <HostCaption size="lg" className="min-w-0 flex-1" />
          </div>
        </div>
        {actions}
      </ScreenShell>
    )
  }

  return (
    <ScreenShell>
      <Confetti run={win} />
      <Marquee />
      {top}
      <div className="relative z-30 flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <motion.div initial={{ scale: 0.3, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', damping: 10 }} className="relative">
          <HostAvatar mood="celebrate" talking={talking} size={150} reactKey={state.host.key} />
        </motion.div>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="gold-text font-display text-5xl font-black uppercase italic leading-none tracking-wide"
        >
          <TrophyIcon size={34} weight="fill" className="mr-1 inline text-gold" aria-hidden="true" />
          Winner
        </motion.p>
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5, type: 'spring', damping: 12 }}>
          <Scores first={outcome} />
        </motion.div>
        <HostCaption size="lg" tail="top" className="mt-2 w-full text-center" />
      </div>
      <div className="relative z-30">{actions}</div>
    </ScreenShell>
  )
}

/* ------------------------------ share card ------------------------------ */

export function ShareCard() {
  const { state } = useGame()
  const w = state.outcome === 0 || state.outcome === 1 ? state.outcome : 0
  const l: PlayerId = w === 0 ? 1 : 0
  return (
    <div className="relative overflow-hidden rounded-3xl border-2 border-gold/60 bg-stage-900 p-5 text-center shadow-[0_20px_50px_-20px_rgba(255,201,64,0.6)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_0%,rgba(155,123,255,0.35),transparent_70%)]" aria-hidden="true" />
      <div className="relative">
        <p className="font-display text-sm font-extrabold uppercase tracking-[0.35em] text-ink-muted">On the board · live</p>
        <div className="mt-3 flex justify-center">
          <PlayerAvatar player={w} variant={state.players[w].avatar} size={72} />
        </div>
        <p className="font-display text-5xl font-black uppercase italic leading-none" style={{ color: colorOf(w) }}>
          {state.players[w].name}
        </p>
        <p className="mt-1 inline-flex items-center gap-1.5 font-display text-xl font-extrabold uppercase tracking-[0.2em] text-gold">
          <TrophyIcon size={20} weight="fill" /> Winner
        </p>
        <p className="mt-2 font-display text-6xl font-black tabular leading-none text-ink">
          {state.players[w].score} <span className="text-ink-muted">—</span> {state.players[l].score}
        </p>
        <p className="mt-3 text-lg font-extrabold italic text-ink-soft">“{resultQuote(state, w)}”</p>
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-ink-muted">Hosted by Nova · vs {state.players[l].name}</p>
      </div>
    </div>
  )
}
