import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { GameProvider, useGame } from '@/game/GameContext'
import { loadTicket } from '@/game/live'
import type { Screen } from '@/game/machine'
import { FrameContext } from '@/components/ui/frame'
import { StageBackdrop, type StageTheme } from '@/components/Stage'
import { AudienceLayer, ReactionLayer, Toast } from '@/components/Overlays'
import { PauseOverlay } from '@/components/PauseOverlay'
import { AboutSheet, LeaderboardSheet, SettingsSheet, ShareSheet } from '@/components/Sheets'
import { Home } from '@/screens/Home'
import { CreateGame, Setup } from '@/screens/Setup'
import { JoinGame } from '@/screens/CreateJoin'
import { Lobby } from '@/screens/Lobby'
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

/**
 * Opens the two kinds of link a player can be sent.
 *
 *   /r/K7QM     a friend's live game: straight to the join screen with the code in.
 *   /g/ABC123   a board somebody shared: you will play the same questions.
 *
 * A page reload in the middle of a game takes priority over either, because the
 * player's seat is waiting for them.
 */
function useDeepLinks() {
  const { loadShared, act, showToast, ready } = useGame()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current || !ready) return
    handled.current = true
    if (loadTicket()) return

    const path = window.location.pathname
    const room = path.match(/^\/r\/([A-Za-z0-9]{4})\/?$/)
    if (room) {
      act({ type: 'NAV', screen: 'join' })
      return
    }
    const shared = path.match(/^\/g\/([A-Za-z0-9]{4,10})\/?$/)
    if (shared) {
      void (async () => {
        const game = await loadShared(shared[1].toUpperCase())
        if (game) showToast('Board loaded. You will play the same questions.')
        else showToast('That game link could not be found')
        window.history.replaceState(null, '', '/')
      })()
    }
  }, [ready, loadShared, act, showToast])
}

/** Once a game is under way the invite link has done its job; keep the address bar tidy. */
function useTidyAddress(inRoom: boolean) {
  useEffect(() => {
    if (inRoom && /^\/(r|g)\//.test(window.location.pathname)) window.history.replaceState(null, '', '/')
  }, [inRoom])
}

function LinkStatus() {
  const { link, state } = useGame()
  const rejoining = link === 'reconnecting' || (link === 'connecting' && !state.room)
  if (!rejoining) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center" role="status">
      <span className="rounded-full border border-gold/40 bg-stage-950/90 px-4 py-1.5 font-display text-sm font-extrabold uppercase tracking-[0.18em] text-gold">
        {link === 'reconnecting' ? 'Reconnecting…' : 'Rejoining your game…'}
      </span>
    </div>
  )
}

function Device() {
  const { state, settings } = useGame()
  useDeepLinks()
  useTidyAddress(Boolean(state.room))
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
          <LinkStatus />
          <PauseOverlay />
          <SettingsSheet />
          <AboutSheet />
          <ShareSheet />
          <LeaderboardSheet />
        </FrameContext.Provider>
      </div>
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
