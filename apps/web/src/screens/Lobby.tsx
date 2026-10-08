import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CheckIcon, CopyIcon, PlayIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { PlayerId } from '@/game/machine'
import { PERSONALITIES } from '@/game/host'
import { SHOW_NAME } from '@/game/questions'
import { HostBlock } from '@/components/Host'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Dots, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { copyText, isDismissal } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

type Presence = 'empty' | 'joined' | 'ready'

/** True on an address only this computer or its own network can reach. An invite
 *  link built from it would not open for a friend in another city. */
const onPrivateAddress = /^(localhost$|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname)

function Seat({ player, presence }: { player: PlayerId; presence: Presence }) {
  const { state } = useGame()
  const p = state.players[player]
  const color = player === 0 ? 'var(--color-p1)' : 'var(--color-p2)'
  const computer = state.controllers[player] === 'bot'
  const caption = player === 0 ? 'You' : computer ? 'Computer' : 'Opponent'

  if (presence === 'empty') {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <div className="grid size-[80px] place-items-center rounded-full border-2 border-dashed border-white/20 text-ink-muted" aria-hidden="true">
          <span className="font-display text-3xl font-black">?</span>
        </div>
        <p className="font-display text-xl font-black uppercase italic leading-none text-ink-muted">Open seat</p>
        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-stage-700 px-2.5 font-display text-sm font-extrabold uppercase tracking-wider text-ink-soft" role="status">
          Waiting <Dots />
        </span>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div className={cn('rounded-full p-1 transition-opacity duration-300', presence === 'joined' && 'opacity-50')} style={{ boxShadow: `0 0 0 2px ${color}` }}>
        <PlayerAvatar player={player} variant={p.avatar} size={72} mood={presence === 'ready' ? 'happy' : 'neutral'} />
      </div>
      <p className="max-w-full truncate font-display text-2xl font-black uppercase italic leading-none" style={{ color }}>
        {p.name}
      </p>
      <p className="text-[0.7rem] font-bold uppercase tracking-wider text-ink-muted">{caption}</p>
      <span
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-display text-sm font-extrabold uppercase tracking-wider',
          presence === 'ready' ? 'bg-correct/15 text-correct' : 'bg-stage-700 text-ink-soft',
        )}
        role="status"
      >
        {presence === 'ready' ? (
          <>
            <CheckIcon size={14} weight="bold" /> Here
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
  const { state, settings, updateSettings, setLevel, showToast, startMatch, leaveRoom, play } = useGame()
  const room = state.room
  const code = room?.code ?? ''
  const computer = room?.mode === 'bot'
  const [starting, setStarting] = useState(false)

  const seated = state.seated[1]
  const there = state.connected[1]
  const here = state.connected[0]
  const everyoneHere = seated && there && here
  const opponent = state.players[1]

  const mine: Presence = 'ready'
  const theirs: Presence = !seated ? 'empty' : there ? 'ready' : 'joined'

  // Say so when somebody sits down, and when the start comes from the other side.
  const wasSeated = useRef(seated)
  useEffect(() => {
    if (seated && !wasSeated.current) {
      play('pop')
      if (!computer) showToast(`${opponent.name} joined!`)
    }
    wasSeated.current = seated
  }, [seated, computer, opponent.name, play, showToast])

  useEffect(() => {
    if (state.screen !== 'lobby') setStarting(false)
  }, [state.screen])

  const link = `${window.location.origin}/r/${code}`
  const copyCode = async () => {
    // When copying is not possible the code is put on screen to read out instead.
    showToast((await copyText(code)) ? `Room code ${code} copied` : `Room code: ${code}`)
  }
  const invite = async () => {
    const text = `${state.players[0].name} has challenged you on ${SHOW_NAME}! Join with code ${code}: ${link}`
    if (navigator.share) {
      try {
        await navigator.share({ title: SHOW_NAME, text })
        return
      } catch (err) {
        if (isDismissal(err)) return
        /* sharing failed for another reason: fall back to copying */
      }
    }
    showToast((await copyText(text)) ? 'Invite copied' : `Send them this link: ${link}`)
  }

  const start = () => {
    setStarting(true)
    startMatch()
    // If the server refuses (the other player just dropped), unlock the button.
    window.setTimeout(() => setStarting(false), 4000)
  }

  return (
    <ScreenShell>
      <TopBar
        onBack={leaveRoom}
        title={<span className="font-display text-xl font-extrabold uppercase tracking-[0.2em]">{computer ? 'Get ready' : 'Game lobby'}</span>}
      />
      <div className="scrollbar-none -mx-4 flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2">
        <HostBlock avatar={64} size="sm" className="mt-1" />

        <section aria-label="Players" className="relative rounded-3xl border border-white/10 bg-stage-800/60 p-4">
          {!computer && (
            <button
              type="button"
              onClick={copyCode}
              className="absolute right-3 top-3 inline-flex h-8 items-center gap-1 rounded-full bg-stage-950 px-2.5 font-display text-sm font-bold tracking-[0.18em] text-ink-soft hover:text-ink"
              aria-label={`Copy room code ${code}`}
            >
              ROOM {code} <CopyIcon size={14} weight="bold" />
            </button>
          )}
          <div className="mt-6 flex items-start gap-2">
            <Seat player={0} presence={mine} />
            <motion.span
              className="mt-6 font-display text-4xl font-black italic text-gold"
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ repeat: Infinity, duration: 1.8 }}
            >
              VS
            </motion.span>
            <Seat player={1} presence={theirs} />
          </div>
        </section>

        {!computer && !seated && (
          <section aria-label="Invite a friend" className="rounded-3xl border border-gold/30 bg-stage-800/60 p-4 text-center">
            <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">Room code</p>
            <div className="mt-2 flex justify-center gap-2" aria-label={`Room code ${code.split('').join(' ')}`}>
              {code.split('').map((c, i) => (
                <motion.span
                  key={i}
                  initial={{ rotateX: 90, opacity: 0 }}
                  animate={{ rotateX: 0, opacity: 1 }}
                  transition={{ delay: 0.1 + i * 0.1, type: 'spring', damping: 14 }}
                  className="grid h-16 w-14 place-items-center rounded-2xl bg-linear-to-b from-[#fff0bf] via-gold to-gold-deep font-display text-4xl font-black text-stage-950 shadow-[0_5px_0_0_#8f5200]"
                  aria-hidden="true"
                >
                  {c}
                </motion.span>
              ))}
            </div>
            <p className="mt-3 text-sm font-semibold text-ink-soft">Send your friend the code or the link. They can be anywhere.</p>
            {onPrivateAddress && (
              <p role="note" className="mt-3 rounded-xl border border-gold/40 bg-stage-950/70 px-3 py-2 text-left text-xs font-semibold text-ink-soft">
                You are on <span className="text-ink">{window.location.host}</span>, which only works on your own network. To play someone in another city, open the game from its
                public address and create the game from there, so the invite link works for them.
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Button variant="outline" size="md" onClick={copyCode}>
                <CopyIcon size={20} weight="bold" /> Copy code
              </Button>
              <Button size="md" onClick={invite}>
                <ShareNetworkIcon size={20} weight="bold" /> Invite
              </Button>
            </div>
          </section>
        )}

        <section aria-labelledby="settings-h" className="rounded-3xl border border-white/10 bg-stage-800/60 px-4 pb-3 pt-3">
          <h2 id="settings-h" className="mb-1 font-display text-lg font-extrabold uppercase tracking-[0.2em] text-ink-soft">
            Game settings
          </h2>
          <Row label="Category">{room?.category.name ?? '…'}</Row>
          <Row label="Rounds">{room ? `${room.rounds} · final ×3` : '…'}</Row>
          {computer && (
            <>
              <p className="mb-1.5 mt-2.5 text-sm font-bold text-ink-muted">Computer difficulty</p>
              <Segmented
                label="Computer difficulty"
                value={settings.difficulty}
                onChange={setLevel}
                options={[
                  { value: 'easy', label: 'Easy' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'hard', label: 'Hard' },
                  { value: 'insane', label: 'Insane' },
                ]}
              />
            </>
          )}
          <p className="mb-1.5 mt-3 text-sm font-bold text-ink-muted">Host personality (on your phone)</p>
          <Segmented
            label="Host personality"
            value={settings.personality}
            onChange={(personality) => updateSettings({ personality })}
            options={PERSONALITIES.map((p) => ({ value: p.id, label: p.label }))}
          />
        </section>
      </div>

      <Button size="xl" block className={cn('mt-3', everyoneHere && !starting && 'animate-glow')} disabled={!everyoneHere || starting} onClick={start}>
        {starting ? (
          <>Starting…</>
        ) : !seated ? (
          <>Waiting for a friend to join…</>
        ) : !there ? (
          <>Waiting for {opponent.name} to connect…</>
        ) : (
          <>
            <PlayIcon size={24} weight="fill" /> Start
          </>
        )}
      </Button>
      {!computer && everyoneHere && !starting && <p className="mt-1.5 text-center text-xs font-semibold text-ink-muted">Either of you can start. It begins on both phones at once.</p>}
    </ScreenShell>
  )
}
