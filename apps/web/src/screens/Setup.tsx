import { useId, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { CheckIcon, RobotIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { CategoryStrip } from '@/components/CategoryStrip'
import { HostBlock } from '@/components/Host'
import { AVATAR_NAMES, PlayerAvatar } from '@/components/PlayerAvatar'
import { ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Name and look: the one thing every way of starting a game asks for. */
export function ProfileFields({
  name,
  avatar,
  onName,
  onAvatar,
  error,
}: {
  name: string
  avatar: number
  onName: (v: string) => void
  onAvatar: (v: number) => void
  error?: string | null
}) {
  const inputId = useId()
  const errorId = useId()
  const color = 'var(--color-p1)'
  return (
    <>
      <div className="relative">
        <span className="absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: color }} aria-hidden="true" />
        <PlayerAvatar player={0} variant={avatar} size={96} />
      </div>

      <fieldset className="w-full">
        <legend className="mb-2 text-center text-sm font-bold text-ink-soft">Pick your look</legend>
        <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Avatar">
          {AVATAR_NAMES.map((label, v) => {
            const selected = avatar === v
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                onClick={() => onAvatar(v)}
                className={cn(
                  'relative grid aspect-square place-items-center rounded-2xl border-2 bg-stage-800/70 transition-[transform,border-color] duration-150 active:scale-95',
                  selected ? 'border-current' : 'border-transparent hover:border-white/20',
                )}
                style={selected ? { color } : undefined}
              >
                <PlayerAvatar player={0} variant={v} size={40} />
                {selected && (
                  <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full text-stage-950" style={{ background: color }}>
                    <CheckIcon size={12} weight="bold" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="w-full">
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-bold text-ink-soft">
          Your name
        </label>
        <input
          id={inputId}
          value={name}
          maxLength={16}
          autoComplete="nickname"
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          onChange={(e) => onName(e.target.value)}
          className="h-14 w-full rounded-2xl border-2 bg-stage-950/80 px-4 font-display text-2xl font-extrabold uppercase tracking-wide text-ink outline-none transition-[border-color,box-shadow] focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--c)_30%,transparent)]"
          style={{ borderColor: error ? 'var(--color-wrong)' : color, ['--c' as string]: color }}
          placeholder="Your name"
        />
        <p id={errorId} className={cn('mt-1.5 text-sm font-semibold', error ? 'text-[#ff9aa4]' : 'text-ink-muted')} role={error ? 'alert' : undefined}>
          {error ?? 'Up to 16 characters. This is what your opponent sees.'}
        </p>
      </div>
    </>
  )
}

/**
 * Starting a game: who you are, and which category. `live` opens a room for a
 * friend to join; `bot` opens one with the computer already in the other seat.
 */
function PlayerSetup({ mode }: { mode: 'live' | 'bot' }) {
  const { profile, saveProfile, act, createRoom, sharedGame, ready } = useGame()
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = mode === 'live'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Enter a name so your opponent knows who you are.')
      return
    }
    setError(null)
    setBusy(true)
    saveProfile({ name, avatar })
    const ok = await createRoom({ bot: !live, name: name.trim(), avatar })
    // On success the server's first picture moves this screen to the lobby.
    if (!ok) setBusy(false)
  }

  return (
    <ScreenShell>
      <TopBar
        onBack={() => act({ type: 'NAV', screen: 'home' })}
        title={<span className="font-display text-xl font-extrabold uppercase tracking-[0.2em]">{live ? 'Play a friend' : 'Play the computer'}</span>}
      />
      <HostBlock avatar={56} size="sm" className="mt-1" />

      <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
        <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="scrollbar-none -mx-4 flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-2 pt-3">
          <div className="text-center">
            <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">Who's playing?</p>
          </div>
          <ProfileFields name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} error={error} />
          {sharedGame ? (
            <p className="w-full rounded-2xl border border-gold/40 bg-stage-800/70 px-3 py-2.5 text-sm font-semibold text-ink-soft">
              Playing the same <span className="text-ink">{sharedGame.title}</span> board a friend shared.
            </p>
          ) : (
            <CategoryStrip className="w-full" />
          )}
        </motion.div>

        <Button type="submit" size="xl" block className="mt-3" disabled={busy || !ready}>
          {busy ? (
            'Setting up the studio…'
          ) : live ? (
            <>
              <UsersThreeIcon size={24} weight="fill" /> Create game
            </>
          ) : (
            <>
              <RobotIcon size={24} weight="fill" /> Play the computer
            </>
          )}
        </Button>
      </form>
    </ScreenShell>
  )
}

/** Against the computer. */
export function Setup() {
  return <PlayerSetup mode="bot" />
}

/** Against a friend: opens a room and waits for them. */
export function CreateGame() {
  return <PlayerSetup mode="live" />
}
