import { Switch as RadixSwitch } from 'radix-ui'
import { useId, type ReactNode } from 'react'

interface Props {
  label: string
  hint?: string
  icon?: ReactNode
  checked: boolean
  onCheckedChange: (v: boolean) => void
}

export function SwitchRow({ label, hint, icon, checked, onCheckedChange }: Props) {
  const id = useId()
  return (
    <div className="flex min-h-14 items-center gap-3 py-1">
      {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-stage-700 text-host">{icon}</span>}
      <label htmlFor={id} className="flex-1">
        <span className="block font-bold text-ink">{label}</span>
        {hint && <span className="block text-sm text-ink-muted">{hint}</span>}
      </label>
      <span className="w-8 text-right font-display text-sm font-bold tracking-wider text-ink-muted" aria-hidden="true">
        {checked ? 'ON' : 'OFF'}
      </span>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-8 w-14 shrink-0 rounded-full border-2 border-stage-500 bg-stage-900 transition-colors duration-200 data-[state=checked]:border-gold data-[state=checked]:bg-gold"
      >
        <RadixSwitch.Thumb className="block size-6 translate-x-0.5 rounded-full bg-ink-soft shadow-md transition-transform duration-200 data-[state=checked]:translate-x-[26px] data-[state=checked]:bg-stage-950" />
      </RadixSwitch.Root>
    </div>
  )
}
