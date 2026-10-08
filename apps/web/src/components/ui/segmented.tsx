import { ToggleGroup } from 'radix-ui'
import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: string
  disabled?: boolean
  note?: string
}

interface Props<T extends string> {
  label: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  className?: string
}

/** Single-choice segmented control (keyboard: arrow keys move between options). */
export function Segmented<T extends string>({ label, value, options, onChange, className }: Props<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn('grid gap-1 rounded-2xl border border-white/10 bg-stage-950/60 p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className="relative flex min-h-11 flex-col items-center justify-center rounded-xl px-1 font-display text-[0.95rem] font-bold uppercase tracking-wide text-ink-soft transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 data-[state=on]:bg-host data-[state=on]:text-white data-[state=on]:shadow-[0_3px_0_0_var(--color-host-deep)]"
        >
          {o.label}
          {o.note && <span className="font-body text-[0.65rem] font-bold normal-case tracking-normal opacity-80">{o.note}</span>}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
