import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  FireIcon,
  HourglassIcon,
  KeyboardIcon,
  LightningIcon,
  LockSimpleIcon,
  SnowflakeIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { PlayerId, RoundState } from '@/game/machine'
import { AnswerBoard } from '@/components/AnswerBoard'
import { HostBlock } from '@/components/Host'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { ScoreBar, TimerRing, type ChipStatus } from '@/components/ScoreBar'
import { CountdownOverlay, StrikeOverlay } from '@/components/Overlays'
import { Dots, ScreenShell, SettingsButton, SoundToggle, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { useNow } from '@/lib/hooks'
import { cn, fmtTime } from '@/lib/utils'

const colorOf = (p: PlayerId) => (p === 0 ? 'var(--color-p1)' : 'var(--color-p2)')
const variantOf = (p: PlayerId): 'p1' | 'p2' => (p === 0 ? 'p1' : 'p2')
const hasSub = (r: RoundState, p: PlayerId) => r.subs.some((s) => s.player === p)
const answerOpen = (r: RoundState) => r.frozenAt === null && (r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen))

/** Is the other player's "typing" signal on right now? Shows that they are
 *  busy, never what they wrote. */
function useOpponentTyping(r: RoundState): boolean {
  const { state } = useGame()
  const now = useNow(answerOpen(r), 250)
  const fromSnapshot = r.typingUntil[1] > 0 && now >= r.typingFrom[1] && now < r.typingUntil[1]
  return fromSnapshot || now < state.opponentTypingUntil
}

/* ------------------------------ header ------------------------------ */

function RoundChip({ r }: { r: RoundState }) {
  const { state } = useGame()
  const label = r.def.kind === 'sudden' ? 'Sudden death' : `Round ${r.number} / ${state.deck.length}`
  return (
    <span className="inline-flex h-9 items-center rounded-full border border-white/10 bg-stage-800/80 px-3 font-display text-base font-extrabold uppercase tracking-[0.14em] text-ink">
      {label}
    </span>
  )
}

function RoundBadge({ r }: { r: RoundState }) {
  if (r.def.kind === 'double')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-host px-2.5 py-1 font-display text-sm font-extrabold uppercase tracking-wider text-white">
        <LightningIcon size={14} weight="fill" /> Double ×2
      </span>
    )
  if (r.def.kind === 'final')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-gold to-ember px-2.5 py-1 font-display text-sm font-extrabold uppercase tracking-wider text-stage-950">
        <FireIcon size={14} weight="fill" /> Final ×3
      </span>
    )
  if (r.def.kind === 'sudden')
    return <span className="rounded-full bg-wrong px-2.5 py-1 font-display text-sm font-extrabold uppercase tracking-wider text-white">Winner takes all</span>
  return null
}

/* --------------------------- control deck --------------------------- */

function DeckCard({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: string }) {
  return (
    <motion.div
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -8, opacity: 0, transition: { duration: 0.12 } }}
      className={cn('rounded-3xl border bg-stage-800/85 p-3 backdrop-blur', className)}
      style={{ borderColor: tone ?? 'rgba(255,255,255,0.1)' }}
    >
      {children}
    </motion.div>
  )
}

/** One player's side of the face-off. Yours has the Answer button; the other
 *  player's says whether they are thinking, typing or locked in. */
function Lane({ r, p, onAnswer }: { r: RoundState; p: PlayerId; onAnswer: () => void }) {
  const { state } = useGame()
  const player = state.players[p]
  const sub = r.subs.find((s) => s.player === p)
  const mine = p === 0
  const computer = state.controllers[p] === 'bot'
  const typing = useOpponentTyping(r)
  const color = colorOf(p)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="truncate px-1 font-display text-sm font-extrabold uppercase tracking-[0.16em]" style={{ color }}>
        {mine ? 'You' : player.name}
        {computer && !mine ? ' · computer' : ''}
      </p>
      {sub ? (
        <div className="flex h-16 items-center gap-2 rounded-2xl border-2 bg-stage-950/80 px-3" style={{ borderColor: color }}>
          <LockSimpleIcon size={22} weight="fill" className="shrink-0 text-gold" />
          <div className="min-w-0">
            <p className="font-display text-xs font-bold uppercase tracking-widest text-ink-muted">Locked in · {(sub.at / 1000).toFixed(1)}s</p>
            <p className="truncate font-display text-xl font-extrabold uppercase leading-tight text-ink">{sub.text ? `“${sub.text}”` : '• • • • •'}</p>
          </div>
        </div>
      ) : mine ? (
        <Button variant={variantOf(p)} size="lg" block className="h-16 text-2xl" onClick={onAnswer} aria-label="Answer">
          <KeyboardIcon size={24} weight="bold" /> Answer
        </Button>
      ) : (
        <div className="flex h-16 items-center gap-2 rounded-2xl border border-white/10 bg-stage-950/60 px-3 text-ink-soft" role="status">
          <PlayerAvatar player={p} variant={player.avatar} size={32} mood="neutral" />
          <span className="min-w-0 font-bold">
            <span className="block truncate text-sm">{typing ? 'Typing' : 'Thinking'}</span>
            <Dots className="text-ink-muted" />
          </span>
        </div>
      )}
    </div>
  )
}

function RevealCallout({ r }: { r: RoundState }) {
  const { state } = useGame()
  const sub = r.current
  if (!sub) return null
  const p = sub.player
  const player = state.players[p]
  const color = colorOf(p)
  const q = r.def.question

  let status: { tone: string; node: React.ReactNode }
  if (r.phase === 'reveal') {
    status = {
      tone: 'var(--color-gold)',
      node: (
        <span className="inline-flex items-center gap-2 text-gold">
          Checking the board <Dots />
        </span>
      ),
    }
  } else if (r.phase === 'correct') {
    status = {
      tone: 'var(--color-correct)',
      node: (
        <span className="inline-flex items-center gap-1.5 text-correct">
          <CheckIcon size={18} weight="bold" /> {r.isSteal ? 'Stolen!' : 'On the board'} · +{r.awarded}
        </span>
      ),
    }
  } else if (r.phase === 'late') {
    const onBoard = sub.match !== null
    const same = onBoard && r.tiles[sub.match!].kind !== 'late'
    status = onBoard
      ? {
          tone: 'var(--color-stage-500)',
          node: (
            <span className="inline-flex items-center gap-1.5 text-ink-soft">
              <HourglassIcon size={18} weight="bold" /> {same ? 'Same answer' : 'On the board'} · too slow
            </span>
          ),
        }
      : {
          tone: 'var(--color-wrong)',
          node: (
            <span className="inline-flex items-center gap-1.5 text-[#ff9aa4]">
              <XIcon size={18} weight="bold" /> Not on the board either
            </span>
          ),
        }
  } else {
    status = {
      tone: 'var(--color-wrong)',
      node: (
        <span className="inline-flex items-center gap-1.5 text-[#ff9aa4]">
          <XIcon size={18} weight="bold" /> Not on the board
        </span>
      ),
    }
  }

  const who = p === 0 ? 'You' : player.name
  const heading = r.isSteal ? `${who} ${p === 0 ? 'steal' : 'steals'} with` : r.phase === 'late' ? `${who} said` : `${who} ${p === 0 ? 'were' : 'was'} first`
  const shown = sub.match !== null && r.phase !== 'reveal' ? q.answers[sub.match].text || sub.text : sub.text

  return (
    <DeckCard tone={status.tone} className="border-2">
      <div className="flex items-center gap-2">
        <PlayerAvatar player={p} variant={player.avatar} size={30} mood={r.phase === 'wrong' ? 'sad' : 'happy'} />
        <p className="flex-1 truncate font-display text-sm font-extrabold uppercase tracking-[0.14em]" style={{ color }}>
          {heading}
        </p>
        {r.phase === 'reveal' && <span className="text-xs font-bold text-ink-muted">{(sub.at / 1000).toFixed(1)}s</span>}
      </div>
      <motion.p
        key={`${sub.player}-${sub.at}-${r.phase}`}
        initial={{ scale: r.phase === 'reveal' ? 0.7 : 1.15, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 13, stiffness: 260 }}
        className={cn(
          'my-0.5 truncate text-center font-display text-[2.5rem] font-black uppercase italic leading-tight',
          r.phase === 'wrong' ? 'text-[#ff9aa4] line-through decoration-4' : 'text-ink',
        )}
      >
        “{shown}”
      </motion.p>
      <p className="text-center font-display text-lg font-extrabold uppercase tracking-wider" role="status">
        {status.node}
      </p>
      {r.phase === 'correct' && r.streakBonus && (
        <p className="mt-1.5 flex items-center justify-center gap-1.5 rounded-full bg-ember/20 py-1 font-display text-sm font-extrabold uppercase tracking-wider text-gold">
          <FireIcon size={16} weight="fill" /> {state.players[p].streak} answer streak · ×2 points
        </p>
      )}
    </DeckCard>
  )
}

function StealCard({ r, onAnswer }: { r: RoundState; onAnswer: () => void }) {
  const { state } = useGame()
  const p = r.stealBy!
  const player = state.players[p]
  const mine = p === 0
  const typing = useOpponentTyping(r)
  return (
    <DeckCard tone="var(--color-ember)" className="border-2">
      <motion.p
        initial={{ scale: 1.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 11 }}
        className="ember-text text-center font-display text-4xl font-black uppercase italic leading-none"
      >
        Steal!
      </motion.p>
      <p className="mb-2 mt-1 text-center font-display text-lg font-extrabold uppercase tracking-wide" style={{ color: colorOf(p) }}>
        {mine ? 'You have' : `${player.name} has`} a chance to steal
      </p>
      {!r.stealOpen ? (
        <p className="flex items-center justify-center gap-2 text-sm font-bold text-ink-soft">
          {mine ? 'Your' : `${player.name}'s`} answer is already in <Dots />
        </p>
      ) : mine ? (
        <Button variant={variantOf(p)} size="lg" block className="h-16 text-2xl" onClick={onAnswer}>
          <KeyboardIcon size={24} weight="bold" /> Answer
        </Button>
      ) : (
        <p className="flex items-center justify-center gap-2 font-bold text-ink-soft" role="status">
          {player.name} is {typing ? 'typing' : 'thinking'} <Dots />
        </p>
      )}
    </DeckCard>
  )
}

function OutcomeCard({ r }: { r: RoundState }) {
  const { state } = useGame()
  const w = r.winner
  const done = r.phase === 'done'
  const last = r.def.kind === 'sudden'
  return (
    <DeckCard tone={w !== null ? colorOf(w) : undefined} className="flex flex-col gap-2.5">
      {w !== null ? (
        <div className="flex items-center gap-2.5">
          <PlayerAvatar player={w} variant={state.players[w].avatar} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-2xl font-black uppercase italic leading-none" style={{ color: colorOf(w) }}>
              {w === 0 ? 'You' : state.players[w].name} {r.isSteal ? (w === 0 ? 'steal it' : 'steals it') : w === 0 ? 'take it' : 'takes it'}
            </p>
            <p className="text-sm font-bold text-ink-muted">{last ? 'Sudden death winner' : `Round ${r.number} · ${r.isSteal ? 'stolen' : 'face-off'}`}</p>
          </div>
          <span className="font-display text-4xl font-black italic text-gold">+{r.awarded}</span>
        </div>
      ) : (
        <div className="text-center">
          <p className="font-display text-3xl font-black uppercase italic leading-none text-ink">Nobody scores</p>
          <p className="text-sm font-bold text-ink-muted">The board keeps these points.</p>
        </div>
      )}
      <p className="flex items-center justify-center gap-2 text-sm font-bold text-ink-soft" role="status">
        <EyeIcon size={18} weight="bold" /> {done ? (last ? 'On to the result' : 'On to the round results') : 'Revealing the board'} <Dots />
      </p>
    </DeckCard>
  )
}

function Deck({ r, onAnswer }: { r: RoundState; onAnswer: () => void }) {
  const { state } = useGame()
  const key =
    r.phase === 'reveal' || r.phase === 'correct' || r.phase === 'wrong' || r.phase === 'late'
      ? `callout-${r.current?.player}-${r.current?.at}`
      : r.phase === 'boardReveal' || r.phase === 'done'
        ? 'outcome'
        : r.phase === 'countdown'
          ? 'question'
          : r.phase

  let body: React.ReactNode
  switch (r.phase) {
    case 'question':
    case 'countdown':
      body = (
        <DeckCard className="text-center">
          <p className="font-display text-2xl font-black uppercase italic text-ink">Get ready</p>
          <p className="text-sm font-bold text-ink-muted">
            Face-off: the first answer on the board wins{r.def.multiplier > 1 ? ` · every answer ×${r.def.multiplier}` : ''}.
          </p>
          <div className="mt-2 flex justify-center gap-2">
            {([0, 1] as PlayerId[]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-stage-950/70 px-2.5 py-1 text-sm font-bold" style={{ color: colorOf(p) }}>
                <PlayerAvatar player={p} variant={state.players[p].avatar} size={20} /> {state.players[p].name}
              </span>
            ))}
          </div>
        </DeckCard>
      )
      break
    case 'faceoff':
      body = (
        <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-2 max-[359px]:grid-cols-1">
            <Lane r={r} p={0} onAnswer={onAnswer} />
            <Lane r={r} p={1} onAnswer={onAnswer} />
          </div>
          <p className="text-center text-xs font-bold uppercase tracking-wider text-ink-muted">First correct answer wins the round</p>
        </motion.div>
      )
      break
    case 'reveal':
    case 'correct':
    case 'wrong':
    case 'late':
      body = <RevealCallout r={r} />
      break
    case 'steal':
      body = <StealCard r={r} onAnswer={onAnswer} />
      break
    case 'timeUp':
      body = (
        <DeckCard tone="var(--color-wrong)" className="border-2 text-center">
          <HourglassIcon size={34} weight="fill" className="mx-auto text-wrong" />
          <p className="font-display text-4xl font-black uppercase italic leading-none text-ink">Time's up!</p>
          <p className="text-sm font-bold text-ink-muted">
            {r.stealBy !== null ? `${r.stealBy === 0 ? 'You' : state.players[r.stealBy].name} ran out of time.` : 'Nobody locked in an answer.'}
          </p>
        </DeckCard>
      )
      break
    default:
      body = <OutcomeCard r={r} />
  }

  return (
    <div className="min-h-34">
      <AnimatePresence mode="wait">
        <motion.div key={key}>{body}</motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ---------------------------- answer sheet ---------------------------- */

const POWERUPS = [
  { id: 'freeze', label: 'Freeze', note: '+3s', icon: SnowflakeIcon },
  { id: 'double', label: 'Double', note: 'Soon', icon: LightningIcon },
  { id: 'second', label: '2nd guess', note: 'Soon', icon: CopyIcon },
  { id: 'peek', label: 'Peek', note: 'Soon', icon: EyeIcon },
] as const

function AnswerSheet({ r, onClose }: { r: RoundState; onClose: () => void }) {
  const { state, showToast, react, lockAnswer, sendTyping, freezeClock, draft, setDraft } = useGame()
  const inputId = useId()
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [sent, setSent] = useState(false)
  const p = state.players[0]
  const opp = state.players[1]
  const color = colorOf(0)
  const sub = r.subs.find((s) => s.player === 0 && (r.phase === 'faceoff' || r.phase === 'steal'))
  const steal = r.phase === 'steal'
  const running = answerOpen(r) && !state.paused
  const now = useNow(running, 200)
  const left = r.deadline !== null ? Math.max(0, r.deadline - (r.frozenAt ?? (state.paused ? state.pausedAt ?? now : now))) : 0

  useEffect(() => {
    if (!sub) inputRef.current?.focus()
  }, [sub])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lock = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) {
      inputRef.current?.focus()
      return
    }
    // The server decides what happens next, including whether we were first.
    setSent(true)
    lockAnswer(draft)
  }

  const activatePower = (id: string) => {
    if (id === 'freeze') {
      if (p.freezeUsed) showToast('Freeze already used this game')
      else {
        freezeClock()
        showToast('Clock frozen · +3 seconds for both of you')
      }
    } else showToast('Power-ups arrive in a future version')
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      initial={{ y: '100%' }}
      animate={{ y: 0, transition: { type: 'spring', damping: 30, stiffness: 340 } }}
      exit={{ y: '100%', transition: { duration: 0.18, ease: 'easeIn' } }}
      className="safe-bottom absolute inset-x-0 bottom-0 z-20 rounded-t-[30px] border-t-2 bg-stage-850 px-4 pt-3 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.7)]"
      style={{ borderColor: color }}
    >
      <div className="flex items-center gap-2">
        <PlayerAvatar player={0} variant={p.avatar} size={32} />
        <p id={titleId} className="flex-1 truncate font-display text-lg font-extrabold uppercase tracking-[0.12em]" style={{ color }}>
          {sub ? 'Locked' : steal ? 'Steal it!' : 'Your answer?'}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide answer panel"
          className="grid size-11 place-items-center rounded-full bg-stage-700 text-ink-soft hover:text-ink"
        >
          <XIcon size={20} weight="bold" />
        </button>
      </div>

      {sub ? (
        <div className="flex flex-col items-center gap-1 py-3 text-center">
          <p className="inline-flex items-center gap-1.5 font-display text-base font-extrabold uppercase tracking-[0.2em] text-correct">
            <CheckIcon size={18} weight="bold" /> Answer locked
          </p>
          <motion.p initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-full truncate font-display text-5xl font-black uppercase italic leading-tight text-ink">
            “{sub.text}”
          </motion.p>
          <p className="font-display text-3xl font-extrabold tabular text-ink-soft">{fmtTime(left)}</p>
          <p className="flex items-center gap-2 text-base font-bold text-ink-soft" role="status">
            Waiting for the host to check it <Dots />
          </p>
          <div className="mt-2 flex gap-1.5" role="group" aria-label="React while you wait">
            {['😎', '🔥', '👀', '😱'].map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => react(0, e)}
                aria-label={`Send ${e}`}
                className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-stage-800 text-xl active:scale-90"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={lock} className="flex flex-col gap-3 pb-2 pt-3">
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            ref={inputRef}
            id={inputId}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              sendTyping()
            }}
            maxLength={32}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Your answer…"
            className="h-16 w-full rounded-2xl border-2 bg-stage-950 px-4 font-display text-3xl font-extrabold uppercase tracking-wide text-ink outline-none"
            style={{ borderColor: color, boxShadow: `0 0 0 4px color-mix(in oklab, ${color} 22%, transparent), 0 0 30px -6px ${color}` }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('font-display text-4xl font-black tabular', left <= 5000 ? 'text-[#ff8f99]' : 'text-ink')} aria-hidden="true">
              {fmtTime(left)}
            </span>
            <div className="ml-auto flex gap-1" role="group" aria-label="Power-ups">
              {POWERUPS.map(({ id, label, note, icon: Icon }) => {
                const available = id === 'freeze' && !p.freezeUsed
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => activatePower(id)}
                    aria-label={`${label} — ${id === 'freeze' ? (p.freezeUsed ? 'used' : 'adds 3 seconds') : 'coming soon'}`}
                    className={cn(
                      'flex size-12 flex-col items-center justify-center rounded-xl border text-[0.6rem] font-extrabold uppercase leading-none',
                      available ? 'border-p2/60 bg-p2/15 text-p2' : 'border-white/10 bg-stage-800 text-ink-muted opacity-70',
                    )}
                  >
                    <Icon size={18} weight="bold" />
                    <span className="mt-0.5">{id === 'freeze' && p.freezeUsed ? 'Used' : note}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <Button type="submit" variant={variantOf(0)} size="xl" block disabled={!running || sent}>
            <LockSimpleIcon size={24} weight="fill" /> {sent ? 'Locking…' : 'Lock answer'}
          </Button>
          <p className="text-center text-xs font-bold uppercase tracking-wider text-ink-muted" aria-live="polite">
            {opp.name} can see that you are typing, not what.
          </p>
        </form>
      )}
    </motion.div>
  )
}

/* ------------------------------- screen ------------------------------- */

export function Round() {
  const { state } = useGame()
  // Keep rendering the last round while this screen animates out (state.round may already be null).
  const lastRound = useRef(state.round)
  if (state.round) lastRound.current = state.round
  const r = lastRound.current!
  const [sheetOpen, setSheetOpen] = useState(false)
  const shake = useAnimationControls()
  const theme = r.def.kind === 'final' ? 'final' : r.def.kind === 'sudden' ? 'sudden' : 'default'
  const oppTyping = useOpponentTyping(r)

  // Close the answer panel once answering is over: the reveal takes the stage.
  useEffect(() => {
    if (!sheetOpen) return
    const stillAnswering = r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen && r.stealBy === 0)
    if (!stillAnswering) setSheetOpen(false)
  }, [r.phase, r.stealOpen, r.stealBy, sheetOpen])

  useEffect(() => {
    if (r.phase === 'wrong') void shake.start({ x: [0, -12, 10, -8, 6, -3, 0], transition: { duration: 0.5 } })
  }, [r.phase, r.phaseStart, shake])

  const status = ([0, 1] as PlayerId[]).map((p): ChipStatus => {
    if (r.winner === p) return 'winner'
    if (r.struck.includes(p)) return 'struck'
    if (r.phase === 'faceoff') return hasSub(r, p) ? 'locked' : p === 1 && oppTyping ? 'thinking' : 'idle'
    return 'idle'
  }) as [ChipStatus, ChipStatus]

  const showTimer = r.deadline !== null && (r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen))
  const hostSmall = r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen)
  const countdownMs = r.phase === 'countdown' && r.nextAt !== null ? r.nextAt - r.phaseStart : 3300

  return (
    <motion.div animate={shake} className="relative h-full">
      <ScreenShell className="gap-2.5">
        <TopBar
          left={<RoundChip r={r} />}
          title={<RoundBadge r={r} />}
          right={
            <>
              <SoundToggle />
              <SettingsButton />
            </>
          }
        />
        <ScoreBar status={status} center={showTimer ? <TimerRing deadline={r.deadline!} duration={r.duration} frozenAt={r.frozenAt} /> : undefined} />
        <HostBlock avatar={hostSmall ? 48 : 64} size="sm" />
        <motion.h2
          key={r.def.question.id}
          initial={{ y: 14, opacity: 0, filter: 'blur(6px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ delay: 0.25, duration: 0.45 }}
          className="px-1 text-center font-display text-[1.7rem] font-extrabold uppercase leading-[1.02] tracking-wide text-ink text-balance"
        >
          {r.def.question.prompt}
        </motion.h2>
        <AnswerBoard question={r.def.question} tiles={r.tiles} players={state.players} theme={theme} compact />
        <div className="mt-auto">
          <Deck r={r} onAnswer={() => setSheetOpen(true)} />
        </div>
      </ScreenShell>

      <AnimatePresence>{r.phase === 'countdown' && <CountdownOverlay key="countdown" phaseStart={r.phaseStart} duration={countdownMs} />}</AnimatePresence>
      <AnimatePresence>{r.phase === 'wrong' && <StrikeOverlay key={r.phaseStart} />}</AnimatePresence>
      <AnimatePresence>{sheetOpen && <AnswerSheet key="sheet" r={r} onClose={() => setSheetOpen(false)} />}</AnimatePresence>
    </motion.div>
  )
}
