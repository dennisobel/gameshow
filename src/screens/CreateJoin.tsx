import { useEffect, useId, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRightIcon, CopyIcon, ShareNetworkIcon, SignInIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { HostBlock } from '@/components/Host'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Dots, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Placeholder: create a private room, then a simulated friend joins. */
export function CreateGame() {
  const { state, act, showToast, play } = useGame()
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setJoined(true)
      play('pop')
    }, 2800)
    return () => window.clearTimeout(id)
  }, [play])

  const share = async () => {
    const text = `Join my game on On The Board! Room code: ${state.roomCode}`
    try {
      if (navigator.share) await navigator.share({ title: 'On The Board', text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('Invite copied')
      }
    } catch {
      /* dismissed */
    }
  }

  const start = () => {
    act({ type: 'SET_CONTROLLERS', controllers: ['human', 'bot'] })
    act({ type: 'NAV', screen: 'lobby' })
  }

  return (
    <ScreenShell>
      <TopBar onBack={() => act({ type: 'NAV', screen: 'home' })} title={<span className="font-display text-xl font-extrabold uppercase tracking-[0.2em]">Create game</span>} />
      <div className="flex flex-1 flex-col items-center gap-5 pt-2">
        <HostBlock avatar={64} size="sm" className="w-full" />
        <div className="text-center">
          <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">Room code</p>
          <div className="mt-2 flex gap-2" aria-label={`Room code ${state.roomCode.split('').join(' ')}`}>
            {state.roomCode.split('').map((c, i) => (
              <motion.span
                key={i}
                initial={{ rotateX: 90, opacity: 0 }}
                animate={{ rotateX: 0, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.1, type: 'spring', damping: 14 }}
                className="grid h-20 w-16 place-items-center rounded-2xl bg-linear-to-b from-[#fff0bf] via-gold to-gold-deep font-display text-5xl font-black text-stage-950 shadow-[0_5px_0_0_#8f5200]"
                aria-hidden="true"
              >
                {c}
              </motion.span>
            ))}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-3">
          <Button
            variant="outline"
            size="md"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.roomCode)
              } catch {
                /* ignore */
              }
              showToast('Code copied')
            }}
          >
            <CopyIcon size={20} weight="bold" /> Copy
          </Button>
          <Button variant="outline" size="md" onClick={share}>
            <ShareNetworkIcon size={20} weight="bold" /> Invite
          </Button>
        </div>

        <div className="flex w-full flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 p-4" role="status">
          <AnimatePresence mode="wait">
            {joined ? (
              <motion.div key="in" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-2">
                <PlayerAvatar player={1} variant={state.players[1].avatar} size={72} />
                <p className="font-display text-2xl font-black uppercase italic text-p2">{state.players[1].name} joined!</p>
              </motion.div>
            ) : (
              <motion.p key="wait" exit={{ opacity: 0 }} className="flex items-center gap-2 font-bold text-ink-soft">
                Waiting for a player to join <Dots />
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
      <Button size="xl" block className={cn('mt-4', joined && 'animate-glow')} disabled={!joined} onClick={start}>
        Go to lobby <ArrowRightIcon size={24} weight="bold" />
      </Button>
    </ScreenShell>
  )
}

/** Placeholder: enter any 4-character code, then "connect" to a simulated room. */
export function JoinGame() {
  const { state, act, play } = useGame()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'joining' | 'joined'>('idle')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.length !== 4) {
      setError('Room codes are 4 characters — check with your host.')
      return
    }
    setError(null)
    setStatus('joining')
    window.setTimeout(() => {
      setStatus('joined')
      play('pop')
      window.setTimeout(() => {
        act({ type: 'SET_CONTROLLERS', controllers: ['human', 'bot'] })
        act({ type: 'NAV', screen: 'lobby' })
      }, 900)
    }, 1400)
  }

  return (
    <ScreenShell>
      <TopBar onBack={() => act({ type: 'NAV', screen: 'home' })} title={<span className="font-display text-xl font-extrabold uppercase tracking-[0.2em]">Join game</span>} />
      <form onSubmit={submit} className="flex flex-1 flex-col gap-5 pt-2" noValidate>
        <HostBlock avatar={64} size="sm" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <label htmlFor={id} className="font-display text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">
            Room code
          </label>
          <input
            id={id}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="••••"
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-hint`}
            className="h-24 w-64 rounded-3xl border-2 border-gold/60 bg-stage-950/80 text-center font-display text-6xl font-black tracking-[0.4em] text-gold outline-none focus:border-gold focus:shadow-[0_0_0_5px_rgba(255,201,64,0.25)]"
          />
          <p id={`${id}-hint`} className={cn('text-sm font-semibold', error ? 'text-[#ff9aa4]' : 'text-ink-muted')} role={error ? 'alert' : 'status'}>
            {error ??
              (status === 'joining' ? (
                <span className="inline-flex items-center gap-2">
                  Finding room <Dots />
                </span>
              ) : status === 'joined' ? (
                `Joined ${state.players[1].name}'s room!`
              ) : (
                'Any 4 letters or numbers work in this prototype.'
              ))}
          </p>
        </div>
        <Button type="submit" size="xl" block disabled={status !== 'idle'}>
          <SignInIcon size={24} weight="bold" /> Join
        </Button>
      </form>
    </ScreenShell>
  )
}
