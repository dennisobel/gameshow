import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { FlaskIcon } from '@phosphor-icons/react'
import { GameProvider, useGame } from '@/game/GameContext'
import type { Screen } from '@/game/machine'
import { FrameContext } from '@/components/ui/frame'
import { StageBackdrop, type StageTheme } from '@/components/Stage'
import { AudienceLayer, ReactionLayer, Toast } from '@/components/Overlays'
import { AboutSheet, DailySheet, DevPanel, LeaderboardSheet, SettingsSheet, ShareSheet } from '@/components/Sheets'
import { Home } from '@/screens/Home'
import { Setup } from '@/screens/Setup'
import { Lobby } from '@/screens/Lobby'
import { CreateGame, JoinGame } from '@/screens/CreateJoin'
import { FinalIntro, Intro, SuddenIntro } from '@/screens/Announcements'
import { Round } from '@/screens/Round'
import { Result, RoundResult, Scoreboard } from '@/screens/Results'

const SCREENS: Record<Screen, () => ReactNode> = {
  home: Home,
  create: CreateGame,
  join: JoinGame,
  setup: Setup,
  lobby: Lobby,
  intro: Intro,
  round: Round,
  roundResult: RoundResult,
  scoreboard: Scoreboard,
  finalIntro: FinalIntro,
  suddenIntro: SuddenIntro,
  result: Result,
}

function themeFor(screen: Screen, kind: string | undefined, outcome: unknown): StageTheme {
  if (screen === 'finalIntro' || (screen === 'round' && kind === 'final')) return 'final'
  if (screen === 'suddenIntro' || (screen === 'round' && kind === 'sudden')) return 'sudden'
  if (screen === 'result' && outcome !== 'draw') return 'win'
  return 'default'
}

function Device() {
  const { state, settings, overlay, setOverlay, devEnabled } = useGame()
  const [frame, setFrame] = useState<HTMLElement | null>(null)

  useEffect(() => {
    document.documentElement.dataset.text = settings.largeText ? 'large' : 'normal'
  }, [settings.largeText])

  const ScreenView = SCREENS[state.screen]
  const screenKey = state.screen === 'round' && state.round ? `round-${state.round.def.question.id}` : state.screen
  const theme = themeFor(state.screen, state.round?.def.kind, state.outcome)

  return (
    <div className="flex min-h-dvh w-full items-center justify-center gap-10 sm:p-6">
      <div
        ref={setFrame}
        data-contrast={settings.highContrast ? 'high' : 'normal'}
        data-motion={settings.reduceMotion ? 'reduced' : 'full'}
        className="relative isolate h-dvh w-full overflow-hidden bg-stage-900 text-ink sm:h-[min(860px,calc(100dvh-48px))] sm:w-[400px] sm:rounded-[46px] sm:border-[10px] sm:border-[#05040f] sm:shadow-[0_0_0_2px_#2a2466,0_40px_120px_-20px_rgba(91,63,217,0.55)]"
      >
        <FrameContext.Provider value={frame}>
          <StageBackdrop theme={theme} bulbs={state.screen === 'home'} />
          <main className="scrollbar-none relative h-full overflow-y-auto overflow-x-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={screenKey}
                className="h-full min-h-[640px]"
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
                exit={{ opacity: 0, y: -14, scale: 1.01, transition: { duration: 0.18, ease: 'easeIn' } }}
              >
                <ScreenView />
              </motion.div>
            </AnimatePresence>
          </main>
          <AudienceLayer />
          <ReactionLayer />
          <Toast />
          {devEnabled && overlay !== 'dev' && (
            <button
              type="button"
              onClick={() => setOverlay('dev')}
              className="absolute bottom-24 right-2 z-30 inline-flex h-10 items-center gap-1 rounded-full border border-gold/50 bg-stage-950/90 px-3 font-mono text-xs font-bold text-gold"
            >
              <FlaskIcon size={14} weight="fill" /> SIM
            </button>
          )}
          <SettingsSheet />
          <AboutSheet />
          <ShareSheet />
          <LeaderboardSheet />
          <DailySheet />
          <DevPanel />
        </FrameContext.Provider>
      </div>

      <aside className="hidden max-w-60 text-sm text-ink-muted xl:block" aria-label="Prototype notes">
        <p className="font-display text-base font-bold uppercase tracking-[0.2em] text-ink-soft">Prototype</p>
        <p className="mt-2">Everything is simulated — the opponent, the room and the AI host.</p>
        <p className="mt-2">
          Tester controls: press <kbd className="rounded bg-stage-800 px-1.5 py-0.5 font-mono text-ink">Shift</kbd> +{' '}
          <kbd className="rounded bg-stage-800 px-1.5 py-0.5 font-mono text-ink">D</kbd>
        </p>
      </aside>
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <Motion>
        <Device />
      </Motion>
    </GameProvider>
  )
}

function Motion({ children }: { children: ReactNode }) {
  const { settings } = useGame()
  return <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>
}
