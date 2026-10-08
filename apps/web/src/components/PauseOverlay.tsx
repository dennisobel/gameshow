import { motion } from 'motion/react'
import { HourglassIcon, RobotIcon, SignOutIcon, WifiSlashIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { Dots } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { useNow } from '@/lib/hooks'

/**
 * What both phones show when the match is held.
 *
 * A dropped connection pauses the show for everyone, because nobody should lose
 * a round to a tunnel or a flat battery. The player who stayed is first told how
 * long the grace period has left, then given a choice: keep waiting, finish
 * against the computer from the same question, or leave.
 */
export function PauseOverlay() {
  const { state, decide, leaveRoom } = useGame()
  const p = state.pause
  const waiting = state.paused && p?.reason === 'disconnect' && !p.decision
  const now = useNow(waiting, 500)

  if (!state.paused || !p) return null

  if (p.reason === 'manual') {
    return (
      <div className="absolute inset-x-0 top-24 z-30 flex justify-center" role="status">
        <span className="rounded-full bg-stage-700 px-4 py-1.5 font-display text-lg font-extrabold uppercase tracking-[0.2em] text-ink">Paused</span>
      </div>
    )
  }

  const missing = state.players[p.seat]
  const left = Math.max(0, Math.ceil((p.until - now) / 1000))

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-40 grid place-items-center bg-stage-950/80 px-6 backdrop-blur-sm"
      role="alertdialog"
      aria-live="assertive"
      aria-label="The game is paused"
    >
      <div className="w-full max-w-xs rounded-3xl border border-white/15 bg-stage-850 p-5 text-center shadow-2xl">
        <WifiSlashIcon size={36} weight="fill" className="mx-auto text-gold" />
        {p.seat === 0 ? (
          <>
            <h2 className="mt-2 font-display text-3xl font-black uppercase italic leading-none text-ink">Reconnecting</h2>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-ink-soft">
              Getting you back in the game <Dots />
            </p>
          </>
        ) : p.decision ? (
          <>
            <h2 className="mt-2 font-display text-3xl font-black uppercase italic leading-none text-ink">{missing.name} is not back</h2>
            <p className="mt-2 text-sm font-semibold text-ink-soft">The game is held exactly where it stopped. What would you like to do?</p>
            <div className="mt-4 flex flex-col gap-2.5">
              <Button size="md" block onClick={() => decide('wait')}>
                <HourglassIcon size={20} weight="bold" /> Keep waiting
              </Button>
              <Button variant="outline" size="md" block onClick={() => decide('bot')}>
                <RobotIcon size={26} weight="fill" /> Finish against the computer
              </Button>
              <Button variant="outline" size="md" block onClick={leaveRoom}>
                <SignOutIcon size={20} weight="bold" /> Leave
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mt-2 font-display text-3xl font-black uppercase italic leading-none text-ink">{missing.name} dropped</h2>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-ink-soft">
              Waiting for them to reconnect <Dots />
            </p>
            <p className="mt-3 font-display text-5xl font-black tabular text-gold">{left}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">seconds before you can choose what to do</p>
          </>
        )}
      </div>
    </motion.div>
  )
}
