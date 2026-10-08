import { CheckIcon, WifiSlashIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { cn } from '@/lib/utils'

/**
 * Category chooser. This is the front door of the product: a player picks a
 * category here and the spin that follows draws its five rounds from that
 * category's bank.
 *
 * Horizontally scrolled rather than a grid, so a long category list stays
 * reachable with one thumb on a phone.
 */
export function CategoryStrip({ className }: { className?: string }) {
  const { categories, selectedCategory, setSelectedCategory, ready, apiError, retry, play } = useGame()

  if (!ready && !apiError) {
    return (
      <div className={cn('flex gap-2 overflow-hidden', className)} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 w-32 shrink-0 animate-pulse rounded-2xl bg-stage-800/70" />
        ))}
      </div>
    )
  }

  if (apiError || categories.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-stage-800/60 px-3 py-2.5 text-sm font-semibold text-ink-soft',
          className,
        )}
        role="alert"
      >
        <span className="flex items-center gap-2">
          <WifiSlashIcon size={16} weight="bold" />
          {apiError ?? 'No categories are available yet.'}
        </span>
        <button type="button" onClick={retry} className="shrink-0 rounded-full bg-stage-700 px-3 py-1 font-display text-sm font-bold uppercase tracking-wider text-ink">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className={className}>
      <p className="mb-1.5 px-1 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">
        Pick a category
      </p>
      <div
        className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="radiogroup"
        aria-label="Category"
      >
        {categories.map((c) => {
          const selected = c.slug === selectedCategory
          return (
            <button
              key={c.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setSelectedCategory(c.slug)
                play('tap')
              }}
              className={cn(
                'relative flex h-16 w-36 shrink-0 flex-col justify-center rounded-2xl border-2 px-3 text-left transition-[transform,border-color,background-color] duration-150 active:scale-[0.97]',
                selected ? 'bg-stage-700' : 'border-transparent bg-stage-800/70 hover:bg-stage-700/80',
              )}
              style={{ borderColor: selected ? c.accent : undefined }}
            >
              <span
                className="font-display text-lg font-extrabold uppercase leading-tight tracking-wide"
                style={{ color: selected ? c.accent : 'var(--color-ink)' }}
              >
                {c.name}
              </span>
              <span className="truncate text-[0.7rem] font-bold text-ink-muted">
                {c.questionCount} questions
              </span>
              {selected && (
                <span
                  className="absolute right-2 top-2 grid size-4 place-items-center rounded-full text-stage-950"
                  style={{ background: c.accent }}
                >
                  <CheckIcon size={10} weight="bold" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
