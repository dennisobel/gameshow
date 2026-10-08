import type { Question } from '@/game/questions'
import type { Player, Tile } from '@/game/machine'
import { cn } from '@/lib/utils'

interface Props {
  question: Question
  tiles: Tile[]
  players: [Player, Player]
  theme?: 'default' | 'final' | 'sudden'
  compact?: boolean
  className?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function describe(tile: Tile, text: string, players: [Player, Player]) {
  if (tile.kind === 'hidden') return 'hidden'
  const who = tile.by !== null ? players[tile.by].name : null
  if (tile.kind === 'won') return `${text}, ${tile.points} points to ${who}`
  if (tile.kind === 'stolen') return `${text}, ${tile.points} points stolen by ${who}`
  if (tile.kind === 'late') return `${text}, also said by ${who} but too slow`
  return `${text}, ${tile.points} points, not claimed`
}

export function AnswerBoard({ question, tiles, players, theme = 'default', compact, className }: Props) {
  let boardOrder = 0
  const rim =
    theme === 'final'
      ? 'border-ember/50 shadow-[0_0_0_1px_rgba(255,122,47,0.25),0_18px_50px_-18px_rgba(255,122,47,0.7)]'
      : theme === 'sudden'
        ? 'border-wrong/50 shadow-[0_18px_50px_-18px_rgba(255,77,94,0.7)]'
        : 'border-gold/25 shadow-[0_18px_50px_-20px_rgba(255,201,64,0.45)]'

  return (
    <section aria-label="Answer board" className={cn('relative rounded-[26px] border bg-stage-950/75 p-2', rim, className)}>
      <div
        className="pointer-events-none absolute inset-x-8 -top-px h-px bg-linear-to-r from-transparent via-gold/70 to-transparent"
        aria-hidden="true"
      />
      <ol className="flex flex-col gap-1.5">
        {tiles.map((tile, i) => {
          const answer = question.answers[i]
          const flipped = tile.kind !== 'hidden'
          const delay = tile.kind === 'board' ? boardOrder++ * 0.26 : 0
          const by = tile.by !== null ? players[tile.by] : null
          const byColor = tile.by === 0 ? 'var(--color-p1)' : 'var(--color-p2)'
          const face = {
            won: 'bg-linear-to-b from-[#fff0bf] via-gold to-gold-deep text-stage-950',
            stolen: 'bg-linear-to-b from-[#fff0bf] via-gold to-ember text-stage-950',
            late: 'bg-stage-600 text-ink',
            board: 'bg-stage-700 text-ink-soft',
            hidden: '',
          }[tile.kind]

          return (
            <li key={i} className={cn('perspective relative', compact ? 'h-11 [@media(min-height:800px)]:h-12' : 'h-12')}>
              <span className="sr-only">
                Answer {i + 1}: {describe(tile, answer.text, players)}
              </span>
              <div
                className="flip-inner preserve-3d relative h-full"
                data-flipped={flipped}
                style={{ transitionDelay: `${delay}s` }}
                aria-hidden="true"
              >
                {/* hidden face */}
                <div className="backface-hidden absolute inset-0 flex items-center gap-2.5 rounded-2xl border border-white/8 bg-stage-800 px-2 shadow-[inset_0_-3px_0_rgba(0,0,0,0.35)]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-gold/60 bg-stage-950 font-display text-base font-extrabold text-gold">
                    {pad(i + 1)}
                  </span>
                  <span className="tile-static h-4 flex-1 rounded-full" />
                  <span className="w-9 text-center font-display text-lg font-extrabold text-stage-500">??</span>
                </div>

                {/* revealed face */}
                <div
                  className={cn(
                    'flip-back backface-hidden absolute inset-0 flex items-center gap-2.5 overflow-hidden rounded-2xl px-2 shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)]',
                    face,
                  )}
                >
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full font-display text-base font-extrabold',
                      tile.kind === 'won' || tile.kind === 'stolen' ? 'bg-stage-950 text-gold' : 'bg-stage-900/70 text-ink-muted',
                    )}
                  >
                    {pad(i + 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-display text-[1.35rem] font-extrabold uppercase leading-none tracking-wide">
                    {answer.text}
                  </span>
                  {by && tile.kind !== 'board' && (
                    <span
                      className="shrink-0 rounded-full bg-stage-950 px-2 py-0.5 font-display text-[0.7rem] font-extrabold uppercase tracking-wider"
                      style={{ color: byColor }}
                    >
                      {tile.kind === 'late' ? 'Too slow' : tile.kind === 'stolen' ? `Stolen · ${by.name}` : by.name}
                    </span>
                  )}
                  <span
                    className={cn(
                      'grid h-8 min-w-11 shrink-0 place-items-center rounded-xl px-1.5 font-display text-xl font-extrabold tabular',
                      tile.kind === 'won' || tile.kind === 'stolen'
                        ? 'bg-stage-950 text-gold'
                        : tile.kind === 'late'
                          ? 'bg-stage-800 text-ink-muted line-through'
                          : 'bg-stage-800/80 text-ink-muted',
                    )}
                  >
                    {tile.kind === 'won' || tile.kind === 'stolen' ? `+${tile.points}` : tile.points}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
