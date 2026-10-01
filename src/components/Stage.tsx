import type { ReactNode } from 'react'
import { ArrowLeftIcon, GearSixIcon, SpeakerHighIcon, SpeakerSlashIcon } from '@phosphor-icons/react'
import { IconButton } from './ui/button'
import { useGame } from '@/game/GameContext'
import { useTripleTap } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export type StageTheme = 'default' | 'final' | 'sudden' | 'win'

const THEME_GLOW: Record<StageTheme, [string, string]> = {
  default: ['var(--color-host)', 'var(--color-p2)'],
  final: ['var(--color-ember)', 'var(--color-gold)'],
  sudden: ['#e2244a', 'var(--color-ember)'],
  win: ['var(--color-gold)', 'var(--color-host)'],
}

/** Studio backdrop: top spotlight, sweeping beams and a floor glow. */
export function StageBackdrop({ theme = 'default', bulbs = false }: { theme?: StageTheme; bulbs?: boolean }) {
  const [a, b] = THEME_GLOW[theme]
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 transition-[background] duration-700"
        style={{
          background: `radial-gradient(120% 60% at 50% -10%, color-mix(in oklab, ${a} 38%, transparent), transparent 60%),
             radial-gradient(90% 40% at 50% 115%, color-mix(in oklab, ${b} 22%, transparent), transparent 70%),
             linear-gradient(180deg, var(--color-stage-900), var(--color-stage-950))`,
        }}
      />
      <div
        className="absolute -left-1/4 -top-10 h-[70%] w-2/3 origin-top animate-sweep opacity-40 blur-2xl"
        style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${a} 45%, transparent), transparent 80%)`, clipPath: 'polygon(45% 0, 55% 0, 100% 100%, 0 100%)' }}
      />
      <div
        className="absolute -right-1/4 -top-10 h-[70%] w-2/3 origin-top animate-sweep opacity-30 blur-2xl [animation-direction:alternate-reverse]"
        style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${b} 45%, transparent), transparent 80%)`, clipPath: 'polygon(45% 0, 55% 0, 100% 100%, 0 100%)' }}
      />
      {bulbs && <Marquee />}
    </div>
  )
}

/** A row of chasing marquee bulbs along the top edge — classic TV-studio signage. */
export function Marquee({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-x-6 top-2 flex justify-between', className)}>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          className="size-1.5 animate-chase rounded-full bg-gold shadow-[0_0_8px_2px_rgba(255,201,64,0.6)]"
          style={{ animationDelay: i % 2 ? '0.8s' : '0s' }}
        />
      ))}
    </div>
  )
}

export function ScreenShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('safe-top safe-bottom relative flex h-full flex-col px-4', className)}>{children}</div>
}

/** "ON AIR" badge. Triple-tap opens the hidden prototype panel. */
export function LiveBadge() {
  const { setOverlay } = useGame()
  const onTap = useTripleTap(() => setOverlay('dev'))
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label="Live show"
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-wrong/40 bg-wrong/15 px-3 font-display text-sm font-extrabold uppercase tracking-[0.18em] text-[#ff9aa4]"
    >
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-wrong" />
        <span className="relative size-2 rounded-full bg-wrong" />
      </span>
      Live
    </button>
  )
}

export function SoundToggle() {
  const { settings, updateSettings } = useGame()
  const muted = !settings.sound && !settings.hostVoice && !settings.music
  return (
    <IconButton
      label={muted ? 'Unmute sound' : 'Mute sound'}
      aria-pressed={muted}
      onClick={() => updateSettings({ sound: muted, hostVoice: muted, music: muted })}
    >
      {muted ? <SpeakerSlashIcon size={22} weight="bold" /> : <SpeakerHighIcon size={22} weight="bold" />}
    </IconButton>
  )
}

export function SettingsButton() {
  const { setOverlay } = useGame()
  return (
    <IconButton label="Settings" onClick={() => setOverlay('settings')}>
      <GearSixIcon size={22} weight="bold" />
    </IconButton>
  )
}

interface TopBarProps {
  onBack?: () => void
  title?: ReactNode
  left?: ReactNode
  right?: ReactNode
}

export function TopBar({ onBack, title, left, right }: TopBarProps) {
  return (
    <header className="relative z-10 flex h-12 shrink-0 items-center gap-2">
      <div className="flex min-w-12 items-center">
        {onBack ? (
          <IconButton label="Back" onClick={onBack}>
            <ArrowLeftIcon size={22} weight="bold" />
          </IconButton>
        ) : (
          left
        )}
      </div>
      <div className="min-w-0 flex-1 text-center">{title}</div>
      <div className="flex min-w-12 items-center justify-end gap-2">
        {right ?? (
          <>
            <SoundToggle />
            <SettingsButton />
          </>
        )}
      </div>
    </header>
  )
}

/** Animated "typing" dots used for simulated opponents. */
export function Dots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-dots rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  )
}

/** Small uppercase label used above sections. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted', className)}>{children}</p>
  )
}
