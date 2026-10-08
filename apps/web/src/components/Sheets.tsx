import { useEffect, useState, type ReactNode } from 'react'
import {
  ClosedCaptioningIcon,
  CopyIcon,
  InfoIcon,
  MicrophoneStageIcon,
  MusicNotesIcon,
  ShareNetworkIcon,
  SpeakerHighIcon,
  TextAaIcon,
  TrophyIcon,
  VibrateIcon,
  CircleHalfIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { PERSONALITIES } from '@/game/host'
import { HOST_NAME, SHOW_NAME } from '@/game/questions'
import { api } from '@/api/client'
import type { ApiLeaderRow } from '@/api/types'
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
  const playingComputer = state.room?.mode === 'bot'
  const inLiveRound = state.screen === 'round' && !playingComputer
  return (
    <Sheet
      open={overlay === 'settings'}
      onOpenChange={(o) => !o && setOverlay(null)}
      title="Settings"
      description={
        state.screen === 'round'
          ? playingComputer
            ? 'The game is paused while settings are open.'
            : 'The clock keeps running in a live game.'
          : undefined
      }
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
        <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-[0.22em] text-ink-muted">Computer difficulty</h3>
        <Segmented
          label="Computer difficulty"
          value={settings.difficulty}
          onChange={(difficulty) => updateSettings({ difficulty })}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
            { value: 'insane', label: 'Insane' },
          ]}
        />
        <p className="mt-1.5 text-xs font-semibold text-ink-muted">Only used when you play against the computer.</p>
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
      {inLiveRound && <span className="sr-only">The clock is running.</span>}
    </Sheet>
  )
}

export function AboutSheet() {
  const { overlay, setOverlay } = useGame()
  return (
    <Sheet open={overlay === 'about'} onOpenChange={(o) => !o && setOverlay(null)} title="About">
      <div className="space-y-3 pb-4 text-ink-soft">
        <p>
          <strong className="text-ink">{SHOW_NAME}</strong> is a two-player game show run by an AI host, {HOST_NAME}. Two people race to name the answers most
          people gave.
        </p>
        <p>
          Play a friend in another city, or practise against the computer. The clock, the scoring and who answered first are all decided by the game server, so
          both players see the same thing at the same moment.
        </p>
        <p className="text-sm text-ink-muted">
          Boards come from a question bank. Answer popularity on AI-written questions is estimated by a simulated panel, not a real survey.
        </p>
      </div>
    </Sheet>
  )
}

/* ------------------------------- share ------------------------------- */

export function ShareSheet() {
  const { overlay, setOverlay, state, showToast } = useGame()
  const w = state.outcome === 0 || state.outcome === 1 ? state.outcome : 0
  const l = w === 0 ? 1 : 0
  // The link is the point of storing a spun game: a friend who opens it
  // plays the same board, not a similar one.
  const shareCode = state.room?.shareCode
  const link = shareCode ? `${window.location.origin}/g/${shareCode}` : ''
  const text = [
    `${state.players[w].name} WINNER`,
    `${state.players[w].score} - ${state.players[l].score}`,
    `"${resultQuote(state, w)}"`,
    `- ${SHOW_NAME}, hosted by ${HOST_NAME}`,
    link ? `Play the same board: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n')
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
      {link && (
        <p className="mt-3 truncate rounded-xl bg-stage-950/70 px-3 py-2 text-center font-mono text-xs text-ink-soft">
          {link}
        </p>
      )}
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

/* ---------------------------- leaderboard ---------------------------- */

/** Wins in live games between two players. Nothing here is invented: with no
 *  finished games, the list is empty and says so. */
export function LeaderboardSheet() {
  const { overlay, setOverlay } = useGame()
  const open = overlay === 'leaderboard'
  const [rows, setRows] = useState<ApiLeaderRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRows(null)
    setFailed(false)
    api
      .leaderboard()
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && setOverlay(null)} title="Leaderboard" description="Wins in live games against another player">
      {failed ? (
        <p className="py-8 text-center font-semibold text-ink-soft">Could not load the leaderboard. Try again in a moment.</p>
      ) : rows === null ? (
        <p className="py-8 text-center font-semibold text-ink-muted" role="status">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
          <TrophyIcon size={40} weight="fill" className="text-gold" />
          <p className="font-display text-2xl font-black uppercase italic text-ink">Nobody is on the board yet</p>
          <p className="text-sm font-semibold text-ink-soft">Win a live game against a friend and your name will be the first one here.</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2 pb-4">
          {rows.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-stage-900/60 px-3 py-2">
              <span className="w-6 text-center font-display text-2xl font-black text-gold">{i + 1}</span>
              <PlayerAvatar player={(i % 2) as 0 | 1} variant={row.avatar} size={36} />
              <span className="min-w-0 flex-1 truncate font-bold text-ink">{row.name}</span>
              <span className="text-right">
                <span className="block font-display text-2xl font-extrabold leading-none tabular text-ink">{row.won}</span>
                <span className="block text-[0.65rem] font-bold uppercase tracking-wider text-ink-muted">
                  {row.won === 1 ? 'win' : 'wins'} · {row.played} played
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  )
}
