import { useId, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRightIcon, CheckIcon, DeviceMobileIcon, GlobeHemisphereEastIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { PlayerId } from '@/game/machine'
import { HostBlock } from '@/components/Host'
import { AVATAR_NAMES, PlayerAvatar } from '@/components/PlayerAvatar'
import { ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

type Opponent = 'online' | 'local'

export function Setup() {
  const { state, act } = useGame()
  const [step, setStep] = useState<PlayerId>(0)
  const [names, setNames] = useState<[string, string]>([state.players[0].name, state.players[1].name])
  const [avatars, setAvatars] = useState<[number, number]>([state.players[0].avatar, state.players[1].avatar])
  const [opponent, setOpponent] = useState<Opponent>(state.controllers.includes('bot') ? 'online' : 'local')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  const color = step === 0 ? 'var(--color-p1)' : 'var(--color-p2)'
  const name = names[step]

  const back = () => {
    setError(null)
    if (step === 1) {
      setStep(0)
      act({ type: 'HOST', event: 'setupP1', mood: 'happy' })
    } else act({ type: 'NAV', screen: 'home' })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Enter a name so the host knows who to cheer for.')
      return
    }
    setError(null)
    act({ type: 'SET_PLAYER', id: step, name, avatar: avatars[step] })
    if (step === 0) {
      setStep(1)
      act({ type: 'HOST', event: 'setupP2', mood: 'smug', vars: { p1: name.trim() } })
    } else {
      act({ type: 'SET_CONTROLLERS', controllers: opponent === 'online' ? ['human', 'bot'] : ['human', 'human'] })
      act({ type: 'NAV', screen: 'lobby' })
    }
  }

  return (
    <ScreenShell>
      <TopBar
        onBack={back}
        title={
          <div className="flex items-center justify-center gap-2" aria-label={`Step ${step + 1} of 2`}>
            {[0, 1].map((i) => (
              <span
                key={i}
                className={cn('h-2 rounded-full transition-all duration-300', i === step ? 'w-8' : 'w-2 bg-stage-600')}
                style={i === step ? { background: color } : undefined}
              />
            ))}
          </div>
        }
      />

      <HostBlock avatar={56} size="sm" className="mt-1" />

      <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -40, opacity: 0, transition: { duration: 0.15 } }}
            className="flex flex-1 flex-col items-center gap-4 pt-4"
          >
            <div className="text-center">
              <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">Who's playing?</p>
              <h2 className="font-display text-5xl font-black uppercase italic leading-none" style={{ color }}>
                Player {step + 1}
              </h2>
            </div>

            <div className="relative">
              <span className="absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: color }} aria-hidden="true" />
              <PlayerAvatar player={step} variant={avatars[step]} size={104} />
            </div>

            <fieldset className="w-full">
              <legend className="mb-2 text-center text-sm font-bold text-ink-soft">Pick your look</legend>
              <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Avatar">
                {AVATAR_NAMES.map((label, v) => {
                  const selected = avatars[step] === v
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={label}
                      onClick={() => setAvatars((a) => (step === 0 ? [v, a[1]] : [a[0], v]))}
                      className={cn(
                        'relative grid aspect-square place-items-center rounded-2xl border-2 bg-stage-800/70 transition-[transform,border-color] duration-150 active:scale-95',
                        selected ? 'border-current' : 'border-transparent hover:border-white/20',
                      )}
                      style={selected ? { color } : undefined}
                    >
                      <PlayerAvatar player={step} variant={v} size={40} />
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
                Name
              </label>
              <input
                id={inputId}
                value={name}
                maxLength={12}
                autoComplete="nickname"
                aria-invalid={Boolean(error)}
                aria-describedby={errorId}
                onChange={(e) => {
                  const v = e.target.value
                  setNames((n) => (step === 0 ? [v, n[1]] : [n[0], v]))
                }}
                className="h-14 w-full rounded-2xl border-2 bg-stage-950/80 px-4 font-display text-2xl font-extrabold uppercase tracking-wide text-ink outline-none transition-[border-color,box-shadow] focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--c)_30%,transparent)]"
                style={{ borderColor: error ? 'var(--color-wrong)' : color, ['--c' as string]: color }}
                placeholder={`Player ${step + 1}`}
              />
              <p id={errorId} className={cn('mt-1.5 text-sm font-semibold', error ? 'text-[#ff9aa4]' : 'text-ink-muted')} role={error ? 'alert' : undefined}>
                {error ?? 'Up to 12 characters.'}
              </p>
            </div>

            {step === 1 && (
              <div className="w-full">
                <p className="mb-1.5 text-sm font-bold text-ink-soft">Opponent</p>
                <Segmented<Opponent>
                  label="Opponent"
                  value={opponent}
                  onChange={setOpponent}
                  options={[
                    { value: 'online', label: 'Online', note: 'Simulated player' },
                    { value: 'local', label: 'This device', note: 'Pass & play' },
                  ]}
                />
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                  {opponent === 'online' ? <GlobeHemisphereEastIcon size={14} /> : <DeviceMobileIcon size={14} />}
                  {opponent === 'online'
                    ? `${name || 'Player 2'} will be played by a simulated online opponent.`
                    : 'Both players answer on this phone — take turns tapping ANSWER.'}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <Button type="submit" variant={step === 0 ? 'p1' : 'p2'} size="xl" block className="mt-4">
          {step === 0 ? (
            <>
              Continue <ArrowRightIcon size={24} weight="bold" />
            </>
          ) : (
            <>
              <CheckIcon size={24} weight="bold" /> Ready
            </>
          )}
        </Button>
      </form>
    </ScreenShell>
  )
}
