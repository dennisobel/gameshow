import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { FireIcon, LightningIcon, SkullIcon } from '@phosphor-icons/react'
import { useGame } from '@/game/GameContext'
import { ROUNDS } from '@/game/questions'
import { HostAvatar } from '@/components/HostAvatar'
import { HostCaption } from '@/components/Host'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Marquee, ScreenShell, TopBar } from '@/components/Stage'
import { Button } from '@/components/ui/button'

const beat = (i: number) => ({
  initial: { y: 28, opacity: 0, scale: 0.9 },
  animate: { y: 0, opacity: 1, scale: 1 },
  transition: { delay: 0.35 + i * 0.45, type: 'spring' as const, damping: 15, stiffness: 200 },
})

/** Full-screen host welcome — a strong transition before the first question. */
export function Intro() {
  const { state, act, talking, line } = useGame()
  const [p1, p2] = state.players
  return (
    <ScreenShell>
      <Marquee />
      <TopBar left={<span />} />
      <p className="sr-only" aria-live="polite">
        Nova says: {line}
      </p>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 12 }}>
          <HostAvatar mood={state.host.mood} talking={talking} size={172} reactKey={state.host.key} />
        </motion.div>
        <motion.p {...beat(0)} className="font-display text-4xl font-black uppercase italic leading-none text-ink">
          Welcome,
        </motion.p>
        <motion.div {...beat(1)} className="flex items-center gap-2">
          <PlayerAvatar player={0} variant={p1.avatar} size={44} />
          <span className="font-display text-6xl font-black uppercase italic leading-none text-p1">{p1.name}!</span>
        </motion.div>
        <motion.p {...beat(2)} className="font-display text-2xl font-bold italic tracking-[0.3em] text-ink-muted">
          versus
        </motion.p>
        <motion.div {...beat(3)} className="flex items-center gap-2">
          <span className="font-display text-6xl font-black uppercase italic leading-none text-p2">{p2.name}!</span>
          <PlayerAvatar player={1} variant={p2.avatar} size={44} />
        </motion.div>
        <motion.p {...beat(4.4)} className="mt-4 font-display text-3xl font-black uppercase leading-[0.95] tracking-wide">
          <span className="gold-text">{ROUNDS.length} rounds.</span>
          <br />
          <span className="text-ink">One winner.</span>
        </motion.p>
      </div>
      <motion.div {...beat(5.2)}>
        <Button size="xl" block className="animate-glow" onClick={() => act({ type: 'BEGIN_ROUND' })}>
          <LightningIcon size={26} weight="fill" /> Let's play
        </Button>
      </motion.div>
    </ScreenShell>
  )
}

function ScoreLine() {
  const { state } = useGame()
  return (
    <div className="flex items-center justify-center gap-5">
      {([0, 1] as const).map((p) => (
        <div key={p} className="flex flex-col items-center">
          <PlayerAvatar player={p} variant={state.players[p].avatar} size={48} />
          <span className="font-display text-lg font-extrabold uppercase tracking-wider" style={{ color: p === 0 ? 'var(--color-p1)' : 'var(--color-p2)' }}>
            {state.players[p].name}
          </span>
          <span className="font-display text-5xl font-black tabular leading-none text-ink">{state.players[p].score}</span>
        </div>
      ))}
    </div>
  )
}

function BigAnnouncement({
  eyebrow,
  title,
  icon,
  titleClass,
  stakes,
  cta,
  ctaVariant,
  onGo,
}: {
  eyebrow: string
  title: ReactNode
  icon: ReactNode
  titleClass: string
  stakes: ReactNode
  cta: string
  ctaVariant: 'ember' | 'gold'
  onGo: () => void
}) {
  const { state, talking } = useGame()
  return (
    <ScreenShell>
      <Marquee />
      <TopBar left={<span />} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <motion.p {...beat(-0.6)} className="font-display text-base font-bold uppercase tracking-[0.35em] text-ink-soft">
          {eyebrow}
        </motion.p>
        <motion.div {...beat(-0.3)} className="flex gap-1 text-ember" aria-hidden="true">
          {icon}
          {icon}
          {icon}
        </motion.div>
        <motion.h1
          initial={{ scale: 2.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 11, stiffness: 200, delay: 0.1 }}
          className={titleClass}
        >
          {title}
        </motion.h1>
        <motion.div {...beat(0.4)}>{stakes}</motion.div>
        <motion.div {...beat(0.9)}>
          <ScoreLine />
        </motion.div>
        <motion.div {...beat(1.3)} className="flex w-full items-start gap-2 text-left">
          <HostAvatar mood={state.host.mood} talking={talking} size={76} reactKey={state.host.key} />
          <HostCaption size="lg" className="min-w-0 flex-1" />
        </motion.div>
      </div>
      <motion.div {...beat(1.8)}>
        <Button variant={ctaVariant} size="xl" block onClick={onGo}>
          {cta}
        </Button>
      </motion.div>
    </ScreenShell>
  )
}

export function FinalIntro() {
  const { act } = useGame()
  const final = ROUNDS[ROUNDS.length - 1]
  const top = final.question.answers[0].points * final.multiplier
  return (
    <BigAnnouncement
      eyebrow={`Round ${ROUNDS.length} of ${ROUNDS.length}`}
      icon={<FireIcon size={40} weight="fill" />}
      title={
        <>
          Final
          <br />
          Round
        </>
      }
      titleClass="ember-text font-display text-[5.6rem] font-black uppercase italic leading-[0.8] drop-shadow-[0_6px_0_rgba(0,0,0,0.4)]"
      stakes={
        <div className="flex flex-col items-center">
          <span className="font-display text-4xl font-black text-ink">{top} POINTS</span>
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-ink-muted">Top answer · every answer ×{final.multiplier}</span>
        </div>
      }
      cta="Enter final round"
      ctaVariant="ember"
      onGo={() => act({ type: 'BEGIN_ROUND' })}
    />
  )
}

export function SuddenIntro() {
  const { act } = useGame()
  return (
    <BigAnnouncement
      eyebrow="We have a tie"
      icon={<SkullIcon size={36} weight="fill" />}
      title={
        <>
          Sudden
          <br />
          Death
        </>
      }
      titleClass="font-display text-[5.6rem] font-black uppercase italic leading-[0.8] text-wrong drop-shadow-[0_6px_0_rgba(0,0,0,0.5)]"
      stakes={
        <p className="font-display text-2xl font-black uppercase leading-tight text-ink">
          One question. One answer.
          <br />
          <span className="gold-text">Winner takes all.</span>
        </p>
      }
      cta="Bring it on"
      ctaVariant="gold"
      onGo={() => act({ type: 'BEGIN_ROUND' })}
    />
  )
}
