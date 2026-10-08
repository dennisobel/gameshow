import { useEffect, useId, useState, type FormEvent } from 'react'
import { SignInIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { ApiRoomPeek } from '@/api/types'
import { HostBlock } from '@/components/Host'
import { Dots, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { ProfileFields } from '@/screens/Setup'
import { cn } from '@/lib/utils'

/** The code from a /r/CODE invite link, if that is how this page was opened. */
export function codeFromLink(): string {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{4})\/?$/)
  return m ? m[1].toUpperCase() : ''
}

type Lookup = { state: 'idle' } | { state: 'looking' } | { state: 'found'; room: ApiRoomPeek } | { state: 'missing' }

/**
 * Joining a friend's game: their four-character code, and who you are. The code
 * is looked up as you type it, so you can see whose game it is before you join.
 */
export function JoinGame() {
  const { profile, saveProfile, act, joinRoom, peekRoom } = useGame()
  const [code, setCode] = useState(codeFromLink)
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

  useEffect(() => {
    if (code.length !== 4) {
      setLookup({ state: 'idle' })
      return
    }
    let cancelled = false
    setLookup({ state: 'looking' })
    void peekRoom(code).then((room) => {
      if (!cancelled) setLookup(room ? { state: 'found', room } : { state: 'missing' })
    })
    return () => {
      cancelled = true
    }
  }, [code, peekRoom])

  const joinable = lookup.state === 'found' && lookup.room.status === 'open' && lookup.room.mode === 'live'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (code.length !== 4) {
      setError('Room codes are 4 characters. Check with your host.')
      return
    }
    if (!name.trim()) {
      setError('Enter a name so your opponent knows who you are.')
      return
    }
    setError(null)
    setBusy(true)
    saveProfile({ name, avatar })
    const ok = await joinRoom(code, { name: name.trim(), avatar })
    if (!ok) setBusy(false)
  }

  let hint: React.ReactNode = 'Ask your host for the 4-letter code.'
  let tone = 'text-ink-muted'
  if (error) {
    hint = error
    tone = 'text-[#ff9aa4]'
  } else if (lookup.state === 'looking') {
    hint = (
      <span className="inline-flex items-center gap-2">
        Finding the game <Dots />
      </span>
    )
  } else if (lookup.state === 'missing') {
    hint = 'No game with that code. Check it with your host.'
    tone = 'text-[#ff9aa4]'
  } else if (lookup.state === 'found') {
    const { room } = lookup
    if (room.status === 'open' && room.mode === 'live') {
      hint = `${room.host.name}'s ${room.category.name} game is waiting for you.`
      tone = 'text-correct'
    } else if (room.mode === 'bot') {
      hint = 'That is a game against the computer; nobody else can join it.'
      tone = 'text-[#ff9aa4]'
    } else {
      hint = room.status === 'full' ? 'That game already has two players.' : 'That game has already started.'
      tone = 'text-[#ff9aa4]'
    }
  }

  return (
    <ScreenShell>
      <TopBar onBack={() => act({ type: 'NAV', screen: 'home' })} title={<span className="font-display text-xl font-extrabold uppercase tracking-[0.2em]">Join game</span>} />
      <HostBlock avatar={56} size="sm" className="mt-1" />
      <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
        <div className="scrollbar-none -mx-4 flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-2 pt-3">
          <div className="flex flex-col items-center gap-2">
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
              aria-invalid={Boolean(error) || lookup.state === 'missing'}
              aria-describedby={`${id}-hint`}
              className="h-20 w-60 rounded-3xl border-2 border-gold/60 bg-stage-950/80 text-center font-display text-5xl font-black tracking-[0.4em] text-gold outline-none focus:border-gold focus:shadow-[0_0_0_5px_rgba(255,201,64,0.25)]"
            />
            <p id={`${id}-hint`} className={cn('min-h-5 text-center text-sm font-semibold', tone)} role={error ? 'alert' : 'status'}>
              {hint}
            </p>
          </div>
          <ProfileFields name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} />
        </div>
        <Button type="submit" size="xl" block className="mt-3" disabled={busy || (lookup.state === 'found' && !joinable)}>
          {busy ? (
            'Joining…'
          ) : (
            <>
              <SignInIcon size={24} weight="bold" /> Join
            </>
          )}
        </Button>
      </form>
    </ScreenShell>
  )
}
