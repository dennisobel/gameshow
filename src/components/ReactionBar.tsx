import { useGame } from '@/game/GameContext'
import type { PlayerId } from '@/game/machine'
import { cn } from '@/lib/utils'

const EMOJI = ['😂', '😱', '😎', '🔥', '👀', '😭']
const TAUNTS = ['Too easy.', "You're cooked.", 'I knew that one.']

/** Emotes + preset taunts. Sent from the player this device controls. */
export function ReactionBar({ from, className, taunts = true }: { from?: PlayerId; className?: string; taunts?: boolean }) {
  const { react, me } = useGame()
  const sender = from ?? me
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Send a reaction">
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => react(sender, e)}
            aria-label={`Send ${e}`}
            className="grid h-12 place-items-center rounded-2xl border border-white/10 bg-stage-800/80 text-2xl transition-transform duration-150 hover:bg-stage-700 active:scale-90"
          >
            {e}
          </button>
        ))}
      </div>
      {taunts && (
        <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Send a taunt">
          {TAUNTS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => react(sender, t)}
              className="h-11 rounded-full border border-white/10 bg-stage-800/80 px-3.5 font-display text-base font-bold uppercase italic tracking-wide text-ink-soft transition-[transform,color] duration-150 hover:text-ink active:scale-95"
            >
              “{t}”
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
