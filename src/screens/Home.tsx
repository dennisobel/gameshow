import { motion } from 'motion/react'
import { CalendarStarIcon, PlayIcon, PlusIcon, RankingIcon, SignInIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { HostBlock } from '@/components/Host'
import { LiveBadge, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'
import { unlockAudio } from '@/lib/sound'

export function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const big = size === 'lg'
  return (
    <h1 className="flex flex-col items-center font-display font-black uppercase italic leading-[0.82]">
      <span className={big ? 'text-2xl tracking-[0.42em] text-ink-soft' : 'text-base tracking-[0.4em] text-ink-soft'}>On the</span>
      <span className={big ? 'gold-text text-[5.4rem] drop-shadow-[0_6px_0_rgba(0,0,0,0.35)]' : 'gold-text text-5xl'}>Board</span>
      <span className="mt-1.5 flex gap-1" aria-hidden="true">
        {[1, 1, 0, 0, 0].map((lit, i) => (
          <span key={i} className={lit ? 'h-1.5 w-7 rounded-full bg-gold' : 'h-1.5 w-7 rounded-full bg-stage-600'} />
        ))}
      </span>
    </h1>
  )
}

function Tile({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 items-center gap-2.5 rounded-2xl border border-white/10 bg-stage-800/70 px-3 text-left transition-[transform,background-color] duration-150 hover:bg-stage-700/80 active:scale-[0.98]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-stage-950 text-gold">{icon}</span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-bold uppercase leading-tight tracking-wide text-ink">{title}</span>
        <span className="block truncate text-xs font-semibold text-ink-muted">{sub}</span>
      </span>
    </button>
  )
}

export function Home() {
  const { act, setOverlay } = useGame()
  const go = (screen: 'setup' | 'create' | 'join') => {
    unlockAudio()
    act({ type: 'NAV', screen })
  }

  return (
    <ScreenShell>
      <TopBar left={<LiveBadge />} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-2 text-center">
        <HostBlock layout="stage" avatar={148} size="sm" />
        <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14, delay: 0.1 }}>
          <Wordmark />
        </motion.div>
        <p className="max-w-[18rem] text-base font-semibold text-ink-soft">
          The AI-hosted answer showdown. <span className="text-ink">Challenge another player.</span>
        </p>
      </div>

      <div className="flex flex-col gap-3 pb-1">
        <Button size="xl" block className="animate-glow" onClick={() => go('setup')}>
          <PlayIcon size={26} weight="fill" /> Play now
        </Button>
        <div className="grid grid-cols-2 gap-3 large:grid-cols-1">
          <Button variant="outline" size="md" onClick={() => go('create')}>
            <PlusIcon size={20} weight="bold" /> Create game
          </Button>
          <Button variant="outline" size="md" onClick={() => go('join')}>
            <SignInIcon size={20} weight="bold" /> Join game
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Tile icon={<CalendarStarIcon size={22} weight="fill" />} title="Daily" sub="Today's board is live" onClick={() => setOverlay('daily')} />
          <Tile icon={<RankingIcon size={22} weight="fill" />} title="Leaderboard" sub="You're #12 this week" onClick={() => setOverlay('leaderboard')} />
        </div>
      </div>
    </ScreenShell>
  )
}
