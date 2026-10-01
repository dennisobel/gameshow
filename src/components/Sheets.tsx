import type { ReactNode } from 'react'
import {
  ClosedCaptioningIcon,
  CopyIcon,
  EyeIcon,
  FlaskIcon,
  InfoIcon,
  MicrophoneStageIcon,
  MusicNotesIcon,
  ShareNetworkIcon,
  SpeakerHighIcon,
  TextAaIcon,
  VibrateIcon,
  CircleHalfIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import type { Controller, DevCmd, Screen } from '@/game/machine'
import { PERSONALITIES } from '@/game/host'
import { HOST_NAME, SHOW_NAME } from '@/game/questions'
import { resultQuote, ShareCard } from '@/screens/Results'
import { Sheet } from './ui/sheet'
import { SwitchRow } from './ui/switch'
import { Segmented } from './ui/segmented'
import { Button } from './ui/button'
import { PlayerAvatar } from './PlayerAvatar'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">{title}</h3>
      <div className="rounded-2xl border border-white/10 bg-stage-900/60 px-3 py-1">{children}</div>
    </section>
  )
}

/* ------------------------------ settings ------------------------------ */

export function SettingsSheet() {
  const { overlay, setOverlay, settings, updateSettings, state } = useGame()
  return (
    <Sheet
      open={overlay === 'settings'}
      onOpenChange={(o) => !o && setOverlay(null)}
      title="Settings"
      description={state.screen === 'round' ? 'The game is paused while settings are open.' : undefined}
    >
      <Section title="Sound">
        <SwitchRow label="Host voice" icon={<MicrophoneStageIcon size={18} weight="bold" />} checked={settings.hostVoice} onCheckedChange={(v) => updateSettings({ hostVoice: v })} />
        <SwitchRow label="Text captions" icon={<ClosedCaptioningIcon size={18} weight="bold" />} checked={settings.captions} onCheckedChange={(v) => updateSettings({ captions: v })} />
        <SwitchRow label="Game sounds" icon={<SpeakerHighIcon size={18} weight="bold" />} checked={settings.sound} onCheckedChange={(v) => updateSettings({ sound: v })} />
        <SwitchRow label="Music" icon={<MusicNotesIcon size={18} weight="bold" />} checked={settings.music} onCheckedChange={(v) => updateSettings({ music: v })} />
        <SwitchRow label="Haptics" hint="Where your device supports it" icon={<VibrateIcon size={18} weight="bold" />} checked={settings.haptics} onCheckedChange={(v) => updateSettings({ haptics: v })} />
      </Section>

      <section className="mt-4">
        <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Host personality</h3>
        <Segmented label="Host personality" value={settings.personality} onChange={(personality) => updateSettings({ personality })} options={PERSONALITIES.map((p) => ({ value: p.id, label: p.label }))} />
      </section>
      <section className="mt-4">
        <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Difficulty</h3>
        <Segmented
          label="Difficulty"
          value={settings.difficulty}
          onChange={(difficulty) => updateSettings({ difficulty })}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
            { value: 'insane', label: 'Insane' },
          ]}
        />
      </section>
      <section className="mt-4">
        <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Language</h3>
        <Segmented
          label="Language"
          value={settings.language}
          onChange={(language) => updateSettings({ language })}
          options={[
            { value: 'en', label: 'English' },
            { value: 'sw', label: 'Swahili', note: 'Soon', disabled: true },
            { value: 'mix', label: 'Mixed', note: 'Soon', disabled: true },
          ]}
        />
      </section>

      <Section title="Accessibility">
        <SwitchRow label="Large text" icon={<TextAaIcon size={18} weight="bold" />} checked={settings.largeText} onCheckedChange={(v) => updateSettings({ largeText: v })} />
        <SwitchRow label="High contrast" icon={<CircleHalfIcon size={18} weight="bold" />} checked={settings.highContrast} onCheckedChange={(v) => updateSettings({ highContrast: v })} />
        <SwitchRow label="Reduce motion" hint="Calmer transitions, no shake or confetti" icon={<SparkleIcon size={18} weight="bold" />} checked={settings.reduceMotion} onCheckedChange={(v) => updateSettings({ reduceMotion: v })} />
      </Section>

      <Button variant="outline" size="md" block className="my-4" onClick={() => setOverlay('about')}>
        <InfoIcon size={20} weight="bold" /> About
      </Button>
    </Sheet>
  )
}

export function AboutSheet() {
  const { overlay, setOverlay } = useGame()
  return (
    <Sheet open={overlay === 'about'} onOpenChange={(o) => !o && setOverlay(null)} title="About">
      <div className="space-y-3 pb-4 text-ink-soft">
        <p>
          <strong className="text-ink">{SHOW_NAME}</strong> is a clickable prototype of a two-player game show run by an AI host, {HOST_NAME}.
        </p>
        <p>Everything is simulated: the opponent, the room, the network and the host. There's no backend and no data leaves this device.</p>
        <p className="text-sm text-ink-muted">Prototype v0.1 · One category · Five mocked boards.</p>
      </div>
    </Sheet>
  )
}

/* ------------------------------- share ------------------------------- */

export function ShareSheet() {
  const { overlay, setOverlay, state, showToast } = useGame()
  const w = state.outcome === 0 || state.outcome === 1 ? state.outcome : 0
  const l = w === 0 ? 1 : 0
  const text = `${state.players[w].name} 🏆 WINNER\n${state.players[w].score} — ${state.players[l].score}\n“${resultQuote(state, w)}”\n— ${SHOW_NAME}, hosted by ${HOST_NAME}`
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: SHOW_NAME, text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('Result copied to clipboard')
      }
    } catch {
      /* share dismissed */
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('Result copied')
    } catch {
      showToast('Copy not available here')
    }
  }
  return (
    <Sheet open={overlay === 'share'} onOpenChange={(o) => !o && setOverlay(null)} title="Share result">
      <ShareCard />
      <div className="my-4 grid grid-cols-2 gap-3">
        <Button variant="outline" size="md" onClick={copy}>
          <CopyIcon size={20} weight="bold" /> Copy
        </Button>
        <Button size="md" onClick={share}>
          <ShareNetworkIcon size={20} weight="bold" /> Share
        </Button>
      </div>
    </Sheet>
  )
}

/* ------------------------- placeholder features ------------------------- */

const BOARD = [
  { name: 'Wanjiru', score: 412, avatar: 4 },
  { name: 'Kip', score: 389, avatar: 3 },
  { name: 'Achieng', score: 350, avatar: 1 },
  { name: 'Musa', score: 297, avatar: 2 },
  { name: 'Zawadi', score: 281, avatar: 5 },
]

export function LeaderboardSheet() {
  const { overlay, setOverlay, state } = useGame()
  return (
    <Sheet open={overlay === 'leaderboard'} onOpenChange={(o) => !o && setOverlay(null)} title="Leaderboard" description="This week · sample data">
      <ol className="flex flex-col gap-2 pb-2">
        {BOARD.map((row, i) => (
          <li key={row.name} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-stage-900/60 px-3 py-2">
            <span className="w-6 text-center font-display text-2xl font-black text-gold">{i + 1}</span>
            <PlayerAvatar player={(i % 2) as 0 | 1} variant={row.avatar} size={36} />
            <span className="flex-1 font-bold text-ink">{row.name}</span>
            <span className="font-display text-2xl font-extrabold tabular text-ink">{row.score}</span>
          </li>
        ))}
        <li className="mt-1 flex items-center gap-3 rounded-2xl border-2 border-p1/60 bg-p1/10 px-3 py-2">
          <span className="w-6 text-center font-display text-2xl font-black text-p1">12</span>
          <PlayerAvatar player={0} variant={state.players[0].avatar} size={36} />
          <span className="flex-1 font-bold text-ink">{state.players[0].name} (you)</span>
          <span className="font-display text-2xl font-extrabold tabular text-ink">164</span>
        </li>
      </ol>
      <p className="pb-4 pt-2 text-center text-sm text-ink-muted">Global rankings arrive with online play.</p>
    </Sheet>
  )
}

export function DailySheet() {
  const { overlay, setOverlay } = useGame()
  return (
    <Sheet open={overlay === 'daily'} onOpenChange={(o) => !o && setOverlay(null)} title="Daily challenge" description="One board a day. Everyone gets the same question.">
      <div className="rounded-3xl border border-gold/40 bg-stage-900/70 p-4 text-center">
        <p className="font-display text-sm font-bold uppercase tracking-[0.25em] text-ink-muted">Today's board</p>
        <p className="mt-1 font-display text-3xl font-extrabold uppercase leading-tight text-ink">Name something you do on a Sunday.</p>
        <div className="mx-auto mt-3 flex max-w-60 flex-col gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="flex h-8 items-center gap-2 rounded-xl bg-stage-800 px-2">
              <span className="font-display font-extrabold text-gold">0{n}</span>
              <span className="tile-static h-3 flex-1 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <Button block size="lg" className="my-4" disabled>
        Opens in a future version
      </Button>
    </Sheet>
  )
}

/* -------------------- prototype-only simulation panel -------------------- */

const MODES: { value: string; label: string; note: string; controllers: [Controller, Controller] }[] = [
  { value: 'p1', label: 'Player 1', note: 'vs bot', controllers: ['human', 'bot'] },
  { value: 'p2', label: 'Player 2', note: 'vs bot', controllers: ['bot', 'human'] },
  { value: 'both', label: 'Both', note: 'Pass & play', controllers: ['human', 'human'] },
  { value: 'host', label: 'Host', note: 'Watch bots', controllers: ['bot', 'bot'] },
]

const COMMANDS: { cmd: DevCmd; label: string }[] = [
  { cmd: 'correct', label: 'Correct answer' },
  { cmd: 'wrong', label: 'Wrong answer' },
  { cmd: 'p1wins', label: 'Player 1 wins' },
  { cmd: 'p2wins', label: 'Player 2 wins' },
  { cmd: 'timeout', label: 'Timeout' },
  { cmd: 'steal', label: 'Trigger steal' },
  { cmd: 'revealBoard', label: 'Reveal board' },
  { cmd: 'final', label: 'Final round' },
  { cmd: 'tie', label: 'Force tie' },
]

const JUMPS: Screen[] = ['home', 'setup', 'lobby', 'intro', 'round', 'roundResult', 'scoreboard', 'finalIntro', 'suddenIntro', 'result', 'create', 'join']

export function DevPanel() {
  const { overlay, setOverlay, state, act } = useGame()
  const mode = MODES.find((m) => m.controllers[0] === state.controllers[0] && m.controllers[1] === state.controllers[1])?.value ?? 'p1'
  const run = (cmd: DevCmd) => {
    act({ type: 'DEV', cmd })
    setOverlay(null)
  }
  return (
    <Sheet
      open={overlay === 'dev'}
      onOpenChange={(o) => !o && setOverlay(null)}
      title="Simulation"
      eyebrow={
        <p className="mb-1 inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.2em] text-gold">
          <FlaskIcon size={14} weight="fill" /> Prototype only
        </p>
      }
      description="Hidden tester controls. Open with Shift+D, the ` key, or triple-tap the LIVE / round badge."
    >
      <p className="mb-3 rounded-xl bg-stage-950/70 px-3 py-2 font-mono text-xs text-ink-soft">
        state: <span className="text-gold">{state.screen.toUpperCase()}</span>
        {state.round && (
          <>
            {' · '}
            <span className="text-p2">{state.round.phase.toUpperCase()}</span>
          </>
        )}
        {state.paused && ' · PAUSED'} · bot: {state.difficulty}
      </p>

      <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Simulation mode · you control</h3>
      <Segmented label="Simulation mode" value={mode} onChange={(v) => act({ type: 'SET_CONTROLLERS', controllers: MODES.find((m) => m.value === v)!.controllers })} options={MODES} />

      <h3 className="mb-1.5 mt-4 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Force</h3>
      <div className="grid grid-cols-2 gap-2">
        {COMMANDS.map(({ cmd, label }) => (
          <button
            key={cmd}
            type="button"
            onClick={() => run(cmd)}
            className="h-12 rounded-xl border border-white/10 bg-stage-700 px-2 font-display text-base font-bold uppercase tracking-wide text-ink transition-colors hover:bg-stage-600 active:scale-[0.98]"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">Answer, timeout and steal controls act on the current round (they fast-forward past the countdown).</p>

      <h3 className="mb-1.5 mt-4 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Jump to state</h3>
      <div className="flex flex-wrap gap-1.5 pb-4">
        {JUMPS.map((screen) => (
          <button
            key={screen}
            type="button"
            onClick={() => act({ type: 'DEV', cmd: 'jump', screen })}
            aria-current={state.screen === screen ? 'true' : undefined}
            className="inline-flex h-10 items-center gap-1 rounded-full border border-white/10 bg-stage-900 px-3 font-mono text-xs font-bold text-ink-soft hover:text-ink aria-[current=true]:border-gold aria-[current=true]:text-gold"
          >
            {screen === state.screen && <EyeIcon size={12} weight="bold" />}
            {screen}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
