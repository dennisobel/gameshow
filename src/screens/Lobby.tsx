import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { CheckIcon, CopyIcon, LockSimpleIcon, PlayIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { PlayerId } from '@/game/machine'
import { CATEGORY, ROUNDS } from '@/game/questions'
import { PERSONALITIES } from '@/game/host'
import { HostBlock } from '@/components/Host'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Dots, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

type Presence = 'connecting' | 'joined' | 'ready'

function Seat({ player, presence }: { player: PlayerId; presence: Presence }) {
  const { state } = useGame()
  const p = state.players[player]
  const color = player === 0 ? 'var(--color-p1)' : 'var(--color-p2)'
  const bot = state.controllers[player] === 'bot'
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div className={cn('rounded-full p-1 transition-opacity duration-300', presence === 'connecting' && 'opacity-40')} style={{ boxShadow: `0 0 0 2px ${color}` }}>
        <PlayerAvatar player={player} variant={p.avatar} size={72} mood={presence === 'ready' ? 'happy' : 'neutral'} />
      </div>
      <p className="max-w-full truncate font-display text-2xl font-black uppercase italic leading-none" style={{ color }}>
        {p.name}
      </p>
      <p className="text-[0.7rem] font-bold uppercase tracking-wider text-ink-muted">{bot ? 'Online · simulated' : player === 0 ? 'You' : 'This device'}</p>
      <span
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-display text-sm font-extrabold uppercase tracking-wider',
          presence === 'ready' ? 'bg-correct/15 text-correct' : 'bg-stage-700 text-ink-soft',
        )}
        role="status"
      >
        {presence === 'ready' ? (
          <>
            <CheckIcon size={14} weight="bold" /> Ready
          </>
        ) : presence === 'joined' ? (
          <>
            Joined <Dots />
          </>
        ) : (
          <>
            Connecting <Dots />
          </>
        )}
      </span>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-white/5 last:border-0">
      <span className="text-sm font-bold text-ink-muted">{label}</span>
      <span className="text-right font-bold text-ink">{children}</span>
    </div>
  )
}

export function Lobby() {
  const { state, act, settings, updateSettings, showToast } = useGame()
  const remote = state.controllers[1] === 'bot'
  const [presence, setPresence] = useState<Presence>(remote ? 'connecting' : 'ready')

  // Fake the second player connecting over the network.
  useEffect(() => {
    if (!remote) return
    const a = window.setTimeout(() => setPresence('joined'), 1100)
    const b = window.setTimeout(() => setPresence('ready'), 2300)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [remote])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.roomCode)
      showToast(`Room code ${state.roomCode} copied`)
    } catch {
      showToast(`Room code: ${state.roomCode}`)
    }
  }

  const ready = presence === 'ready'

  return (
    <ScreenShell>
      <TopBar
        onBack={() => act({ type: 'NAV', screen: 'setup' })}
        title={<span className="font-display text-xl font-extrabold uppercase tracking-[0.2em]">Game lobby</span>}
      />
      <div className="scrollbar-none -mx-4 flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2">
        <HostBlock avatar={64} size="sm" className="mt-1" />

        <section aria-label="Players" className="relative rounded-3xl border border-white/10 bg-stage-800/60 p-4">
          <button
            type="button"
            onClick={copy}
            className="absolute right-3 top-3 inline-flex h-8 items-center gap-1 rounded-full bg-stage-950 px-2.5 font-display text-sm font-bold tracking-[0.18em] text-ink-soft hover:text-ink"
            aria-label={`Copy room code ${state.roomCode}`}
          >
            ROOM {state.roomCode} <CopyIcon size={14} weight="bold" />
          </button>
          <div className="mt-6 flex items-start gap-2">
            <Seat player={0} presence="ready" />
            <motion.span
              className="mt-6 font-display text-4xl font-black italic text-gold"
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ repeat: Infinity, duration: 1.8 }}
            >
              VS
            </motion.span>
            <Seat player={1} presence={presence} />
          </div>
        </section>

        <section aria-labelledby="settings-h" className="rounded-3xl border border-white/10 bg-stage-800/60 px-4 pb-3 pt-3">
          <h2 id="settings-h" className="mb-1 font-display text-lg font-extrabold uppercase tracking-[0.2em] text-ink-soft">
            Game settings
          </h2>
          <Row label="Category">
            <span className="inline-flex items-center gap-1.5">
              {CATEGORY} <LockSimpleIcon size={14} className="text-ink-muted" aria-label="Locked for this prototype" />
            </span>
          </Row>
          <Row label="Rounds">{ROUNDS.length} · final ×3</Row>
          <p className="mb-1.5 mt-2.5 text-sm font-bold text-ink-muted">Difficulty</p>
          <Segmented
            label="Difficulty"
            value={settings.difficulty}
            onChange={(difficulty) => updateSettings({ difficulty })}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
              { value: 'insane', label: 'Insane' },
            ]}
          />
          <p className="mb-1.5 mt-3 text-sm font-bold text-ink-muted">Host personality</p>
          <Segmented
            label="Host personality"
            value={settings.personality}
            onChange={(personality) => updateSettings({ personality })}
            options={PERSONALITIES.map((p) => ({ value: p.id, label: p.label }))}
          />
        </section>
      </div>

      <Button size="xl" block className={cn('mt-3', ready && 'animate-glow')} disabled={!ready} onClick={() => act({ type: 'START_MATCH' })}>
        {ready ? (
          <>
            <PlayIcon size={24} weight="fill" /> Start
          </>
        ) : (
          <>Waiting for {state.players[1].name}…</>
        )}
      </Button>
    </ScreenShell>
  )
}
