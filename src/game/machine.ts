// The game as an explicit state machine (PRD §24). Everything is simulated:
// the opponent is a scripted bot, timing is driven by TICK actions, and all side
// effects (sound, haptics, audience) are emitted as `fx` events for the UI to play.

import { matchAnswer } from './match'
import { ROUNDS, SUDDEN_DEATH, type RoundDef, type RoundKind } from './questions'
import { numberWord, type HostEvent, type HostVars, type Mood } from './host'

export type PlayerId = 0 | 1
export type Controller = 'human' | 'bot'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'insane'

export type Screen =
  | 'home'
  | 'create'
  | 'join'
  | 'setup'
  | 'lobby'
  | 'intro'
  | 'round'
  | 'roundResult'
  | 'scoreboard'
  | 'finalIntro'
  | 'suddenIntro'
  | 'result'

export type Phase =
  | 'question' // host reads the question
  | 'countdown' // 3 · 2 · 1 · GO
  | 'faceoff' // both players race to lock an answer
  | 'reveal' // a locked answer is shown, judgement pending
  | 'correct'
  | 'wrong' // strike
  | 'late' // second answer shown after the round was already won
  | 'steal' // opponent gets a chance to steal
  | 'timeUp'
  | 'boardReveal' // remaining answers flip
  | 'done'

export interface Player {
  name: string
  avatar: number
  score: number
  streak: number
  freezeUsed: boolean
}

export interface Submission {
  player: PlayerId
  text: string
  /** ms after the answer window opened */
  at: number
  match: number | null
  auto?: boolean
}

export type TileKind = 'hidden' | 'won' | 'stolen' | 'late' | 'board'
export interface Tile {
  kind: TileKind
  by: PlayerId | null
  points: number
}

export interface BotPlan {
  at: number
  text: string
}

export interface RoundState {
  def: RoundDef
  number: number
  phase: Phase
  phaseStart: number
  nextAt: number | null
  startedAt: number
  deadline: number | null
  duration: number
  frozenAt: number | null
  subs: Submission[]
  queue: Submission[]
  current: Submission | null
  isSteal: boolean
  stealBy: PlayerId | null
  stealOpen: boolean
  drafts: [string, string]
  bot: [BotPlan | null, BotPlan | null]
  tiles: Tile[]
  struck: PlayerId[]
  winner: PlayerId | null
  awarded: number
  streakBonus: boolean
}

export interface RoundRecord {
  number: number
  kind: RoundKind
  winner: PlayerId | null
  points: number
  answer: string | null
  stolen: boolean
}

export interface HostState {
  event: HostEvent
  vars: HostVars
  mood: Mood
  key: number
}

export interface Fx {
  id: number
  kind: 'sfx' | 'haptic' | 'audience'
  name: string
}

export interface GameState {
  screen: Screen
  players: [Player, Player]
  controllers: [Controller, Controller]
  difficulty: Difficulty
  roundIndex: number
  sudden: number
  round: RoundState | null
  history: RoundRecord[]
  host: HostState
  fx: Fx[]
  fxSeq: number
  paused: boolean
  pausedAt: number | null
  delta: { player: PlayerId; points: number; key: number } | null
  outcome: PlayerId | 'draw' | null
  roomCode: string
}

export type DevCmd =
  | 'correct'
  | 'wrong'
  | 'timeout'
  | 'steal'
  | 'revealBoard'
  | 'final'
  | 'tie'
  | 'p1wins'
  | 'p2wins'
  | 'jump'

export type Input =
  | { type: 'NAV'; screen: Screen }
  | { type: 'HOST'; event: HostEvent; mood: Mood; vars?: HostVars }
  | { type: 'SET_PLAYER'; id: PlayerId; name: string; avatar: number }
  | { type: 'SET_CONTROLLERS'; controllers: [Controller, Controller] }
  | { type: 'SET_DIFFICULTY'; difficulty: Difficulty }
  | { type: 'START_MATCH' }
  | { type: 'BEGIN_ROUND' }
  | { type: 'TICK' }
  | { type: 'DRAFT'; player: PlayerId; text: string }
  | { type: 'LOCK'; player: PlayerId; text: string }
  | { type: 'FREEZE'; player: PlayerId }
  | { type: 'CONTINUE' }
  | { type: 'AFTER_RESULT' }
  | { type: 'AFTER_SCOREBOARD' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'REMATCH' }
  | { type: 'PLAY_AGAIN' }
  | { type: 'DEV'; cmd: DevCmd; screen?: Screen }

export type Action = Input & { now: number; rand: number[] }

/* ------------------------------------------------------------------ */

const BOT: Record<Difficulty, { accuracy: number; min: number; max: number; giveUp: number }> = {
  easy: { accuracy: 0.45, min: 6500, max: 13000, giveUp: 0.12 },
  medium: { accuracy: 0.6, min: 4500, max: 11000, giveUp: 0.08 },
  hard: { accuracy: 0.74, min: 3500, max: 9000, giveUp: 0.05 },
  insane: { accuracy: 0.88, min: 2200, max: 6500, giveUp: 0.02 },
}

export const STEAL_MS = 10_000
export const COUNTDOWN_MS = 3300
const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 32)

export function initialState(): GameState {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const roomCode = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
  return {
    screen: 'home',
    players: [
      { name: 'Denno', avatar: 0, score: 0, streak: 0, freezeUsed: false },
      { name: 'Alex', avatar: 3, score: 0, streak: 0, freezeUsed: false },
    ],
    controllers: ['human', 'bot'],
    difficulty: 'medium',
    roundIndex: 0,
    sudden: 0,
    round: null,
    history: [],
    host: { event: 'home', vars: {}, mood: 'happy', key: 0 },
    fx: [],
    fxSeq: 0,
    paused: false,
    pausedAt: null,
    delta: null,
    outcome: null,
    roomCode,
  }
}

/* -------------------------- small helpers -------------------------- */

function say(s: GameState, event: HostEvent, mood: Mood, vars: HostVars = {}) {
  s.host = { event, vars, mood, key: s.host.key + 1 }
}

function emit(s: GameState, kind: Fx['kind'], name: string) {
  s.fxSeq += 1
  s.fx = [...s.fx.slice(-12), { id: s.fxSeq, kind, name }]
}

function setPhase(r: RoundState, phase: Phase, now: number, nextAt: number | null) {
  r.phase = phase
  r.phaseStart = now
  r.nextAt = nextAt
}

const hasSub = (r: RoundState, p: PlayerId) => r.subs.some((x) => x.player === p)
const name = (s: GameState, p: PlayerId) => s.players[p].name

function resetScores(s: GameState) {
  s.players = s.players.map((p) => ({ ...p, score: 0, streak: 0, freezeUsed: false })) as [Player, Player]
  s.roundIndex = 0
  s.sudden = 0
  s.round = null
  s.history = []
  s.delta = null
  s.outcome = null
  s.paused = false
  s.pausedAt = null
}

function makeBotPlan(r: RoundState, difficulty: Difficulty, rand: number[], now: number, steal: boolean): BotPlan | null {
  const cfg = BOT[difficulty]
  if (!steal && rand[0] < cfg.giveUp) return null
  const q = r.def.question
  const hidden = r.tiles.flatMap((t, i) => (t.kind === 'hidden' ? [i] : []))
  let text: string
  if (rand[1] < cfg.accuracy && hidden.length) {
    // Weight towards the popular answers, like a real player would.
    const total = hidden.reduce((sum, i) => sum + q.answers[i].points, 0)
    let pick = rand[2] * total
    let chosen = hidden[0]
    for (const i of hidden) {
      pick -= q.answers[i].points
      if (pick <= 0) {
        chosen = i
        break
      }
    }
    text = q.answers[chosen].text
  } else {
    text = q.decoys[Math.floor(rand[2] * q.decoys.length)]
  }
  const [min, max] = steal ? [2200, 5200] : [cfg.min, Math.min(cfg.max, r.duration - 1200)]
  return { at: now + min + rand[3] * Math.max(0, max - min), text }
}

function newRound(def: RoundDef, number: number, now: number): RoundState {
  return {
    def,
    number,
    phase: 'question',
    phaseStart: now,
    nextAt: now + 4800,
    startedAt: now,
    deadline: null,
    duration: def.seconds * 1000,
    frozenAt: null,
    subs: [],
    queue: [],
    current: null,
    isSteal: false,
    stealBy: null,
    stealOpen: false,
    drafts: ['', ''],
    bot: [null, null],
    tiles: def.question.answers.map((a) => ({ kind: 'hidden', by: null, points: a.points * def.multiplier })),
    struck: [],
    winner: null,
    awarded: 0,
    streakBonus: false,
  }
}

/* --------------------------- transitions --------------------------- */

function beginRound(s: GameState, now: number) {
  const def = s.sudden > 0 ? SUDDEN_DEATH[s.sudden - 1] : ROUNDS[s.roundIndex]
  const number = s.sudden > 0 ? s.sudden : s.roundIndex + 1
  s.round = newRound(def, number, now)
  s.screen = 'round'
  s.paused = false
  s.pausedAt = null
  const event: HostEvent =
    def.kind === 'double'
      ? 'doubleIntro'
      : def.kind === 'final'
        ? 'finalQuestion'
        : def.kind === 'sudden'
          ? 'suddenQuestion'
          : 'roundIntro'
  say(s, event, def.kind === 'normal' ? 'happy' : 'excited', { n: number, nWord: numberWord(number) })
  emit(s, 'sfx', 'whoosh')
}

function startFaceoff(s: GameState, now: number, rand: number[]) {
  const r = s.round!
  r.startedAt = now
  r.duration = r.def.seconds * 1000
  r.deadline = now + r.duration
  r.frozenAt = null
  setPhase(r, 'faceoff', now, null)
  r.bot = [
    s.controllers[0] === 'bot' ? makeBotPlan(r, s.difficulty, rand.slice(0, 4), now, false) : null,
    s.controllers[1] === 'bot' ? makeBotPlan(r, s.difficulty, rand.slice(4, 8), now, false) : null,
  ]
  say(s, 'faceoff', 'thinking')
}

function lockFaceoff(s: GameState, p: PlayerId, text: string, now: number, rand: number[], auto = false) {
  const r = s.round!
  r.subs.push({ player: p, text: tidy(text), at: now - r.startedAt, match: matchAnswer(r.def.question, text), auto })
  r.drafts[p] = ''
  emit(s, 'sfx', 'lock')
  emit(s, 'haptic', 'lock')
  const o = other(p)
  if (hasSub(r, o)) {
    // Both answers are in — hold for a beat of tension before the reveal.
    r.frozenAt = now
    r.nextAt = now + 1200
    say(s, 'bothLocked', 'thinking')
    return
  }
  if (r.subs.length === 1) say(s, 'firstLock', 'surprised', { name: name(s, p), other: name(s, o) })
  if (s.controllers[o] === 'bot') {
    const plan = r.bot[o]
    // Simulated opponent reacts to the pressure: answers shortly after, or gives up.
    if (plan) plan.at = Math.min(plan.at, now + 900 + rand[9] * 1400)
    else r.nextAt = now + 2400
  }
}

function autoLockDrafts(s: GameState, now: number, players: PlayerId[]) {
  const r = s.round!
  for (const p of players) {
    if (s.controllers[p] === 'human' && !hasSub(r, p) && r.drafts[p].trim()) {
      r.subs.push({
        player: p,
        text: tidy(r.drafts[p]),
        at: (r.deadline ?? now) - r.startedAt,
        match: matchAnswer(r.def.question, r.drafts[p]),
        auto: true,
      })
      r.drafts[p] = ''
    }
  }
}

function endFaceoff(s: GameState, now: number) {
  const r = s.round!
  r.frozenAt = r.frozenAt ?? now
  r.bot = [null, null]
  r.queue = [...r.subs].sort((a, b) => a.at - b.at)
  const first = r.queue.shift()
  if (!first) {
    setPhase(r, 'timeUp', now, now + 2600)
    say(s, 'timeUp', 'surprised')
    emit(s, 'sfx', 'timeup')
    emit(s, 'audience', 'ooh')
    return
  }
  startReveal(s, first, false, now)
}

function startReveal(s: GameState, sub: Submission, isSteal: boolean, now: number) {
  const r = s.round!
  r.current = sub
  r.isSteal = isSteal
  setPhase(r, 'reveal', now, now + 2300)
  const event: HostEvent = isSteal ? 'revealSteal' : r.subs.length > 1 ? 'revealFirst' : 'revealOnly'
  say(s, event, 'thinking', { name: name(s, sub.player), answer: sub.text })
  emit(s, 'sfx', 'drumroll')
}

function judge(s: GameState, now: number) {
  const r = s.round!
  const sub = r.current!
  const p = sub.player
  const m = sub.match
  if (m !== null && r.tiles[m].kind === 'hidden') {
    const player = s.players[p]
    const streakMult = player.streak + 1 >= 3 && r.def.kind !== 'sudden' ? 2 : 1
    const mult = Math.max(r.def.multiplier, streakMult)
    const points = r.def.question.answers[m].points * mult
    r.tiles[m] = { kind: r.isSteal ? 'stolen' : 'won', by: p, points }
    r.streakBonus = streakMult > r.def.multiplier
    player.score += points
    player.streak += 1
    r.winner = p
    r.awarded = points
    s.delta = { player: p, points, key: (s.delta?.key ?? 0) + 1 }
    setPhase(r, 'correct', now, now + 3000)
    say(s, r.isSteal ? 'stealSuccess' : 'correct', r.isSteal ? 'excited' : 'happy', {
      name: name(s, p),
      answer: r.def.question.answers[m].text,
      points,
    })
    emit(s, 'sfx', 'correct')
    emit(s, 'haptic', 'correct')
    emit(s, 'audience', 'cheer')
  } else {
    r.struck.push(p)
    s.players[p].streak = 0
    setPhase(r, 'wrong', now, now + 2400)
    say(s, 'wrong', 'sad', { name: name(s, p), answer: sub.text })
    emit(s, 'sfx', 'buzzer')
    emit(s, 'haptic', 'wrong')
    emit(s, 'audience', 'ooh')
  }
}

function afterCorrect(s: GameState, now: number) {
  const r = s.round!
  if (!r.isSteal) {
    const second = r.queue.find((x) => x.player !== r.winner)
    if (second) {
      r.queue = r.queue.filter((x) => x !== second)
      r.current = second
      let event: HostEvent
      if (second.match === null) event = 'lateWrong'
      else if (r.tiles[second.match].kind !== 'hidden') event = 'lateSame'
      else {
        r.tiles[second.match] = { kind: 'late', by: second.player, points: r.tiles[second.match].points }
        event = 'late'
        emit(s, 'sfx', 'flip')
      }
      setPhase(r, 'late', now, now + 2800)
      say(s, event, 'smug', {
        name: name(s, second.player),
        answer: second.match !== null ? r.def.question.answers[second.match].text : second.text,
      })
      return
    }
  }
  toBoardReveal(s, now)
}

function afterWrong(s: GameState, now: number, rand: number[]) {
  const r = s.round!
  const o = other(r.current!.player)
  if (r.isSteal || r.struck.includes(o)) return toBoardReveal(s, now)
  r.stealBy = o
  const lockedAlready = r.queue.find((x) => x.player === o)
  if (lockedAlready) {
    r.stealOpen = false
    setPhase(r, 'steal', now, now + 2300)
    say(s, 'stealChance', 'excited', { name: name(s, o) })
  } else {
    r.stealOpen = true
    r.startedAt = now
    r.duration = STEAL_MS
    r.deadline = now + STEAL_MS
    r.frozenAt = null
    setPhase(r, 'steal', now, null)
    if (s.controllers[o] === 'bot') r.bot[o] = makeBotPlan(r, s.difficulty, rand.slice(0, 4), now, true)
    say(s, 'stealOpen', 'excited', { name: name(s, o) })
  }
  emit(s, 'sfx', 'steal')
  emit(s, 'audience', 'gasp')
}

function lockSteal(s: GameState, p: PlayerId, text: string, now: number, auto = false) {
  const r = s.round!
  const sub: Submission = { player: p, text: tidy(text), at: now - r.startedAt, match: matchAnswer(r.def.question, text), auto }
  r.subs.push(sub)
  r.drafts[p] = ''
  r.stealOpen = false
  r.frozenAt = now
  r.bot = [null, null]
  emit(s, 'sfx', 'lock')
  emit(s, 'haptic', 'lock')
  startReveal(s, sub, true, now)
}

function toBoardReveal(s: GameState, now: number) {
  const r = s.round!
  let hidden = 0
  r.tiles = r.tiles.map((t) => {
    if (t.kind !== 'hidden') return t
    hidden += 1
    return { ...t, kind: 'board' }
  })
  setPhase(r, 'boardReveal', now, now + 1100 + hidden * 280)
  if (r.winner === null) say(s, 'nobody', 'surprised')
  else say(s, 'boardReveal', 'neutral')
  if (hidden) emit(s, 'sfx', 'cascade')
}

function finishRound(s: GameState, now: number) {
  const r = s.round!
  setPhase(r, 'done', now, null)
  for (const p of [0, 1] as PlayerId[]) if (p !== r.winner) s.players[p].streak = 0
  const won = r.tiles.findIndex((t) => t.kind === 'won' || t.kind === 'stolen')
  s.history = [
    ...s.history,
    {
      number: r.number,
      kind: r.def.kind,
      winner: r.winner,
      points: r.awarded,
      answer: won >= 0 ? r.def.question.answers[won].text : null,
      stolen: r.isSteal && r.winner !== null,
    },
  ]
}

function finishGame(s: GameState, outcome: PlayerId | 'draw') {
  s.outcome = outcome
  s.screen = 'result'
  s.round = null
  s.paused = false
  if (outcome === 'draw') {
    say(s, 'draw', 'surprised')
    emit(s, 'audience', 'ooh')
    return
  }
  const humans = ([0, 1] as PlayerId[]).filter((p) => s.controllers[p] === 'human')
  const loserView = humans.length === 1 && humans[0] !== outcome
  if (loserView) say(s, 'loser', 'happy', { name: name(s, humans[0]), other: name(s, outcome) })
  else say(s, 'winner', 'celebrate', { name: name(s, outcome), other: name(s, other(outcome)) })
  emit(s, 'sfx', 'fanfare')
  emit(s, 'haptic', 'win')
  emit(s, 'audience', 'cheer')
}

function roundWrap(s: GameState) {
  const r = s.round!
  const [a, b] = s.players
  const vars = { nWord: numberWord(r.number) }
  if (r.winner === null) return say(s, 'roundWrapNobody', 'sad', vars)
  if (a.score === b.score) return say(s, 'roundWrapTie', 'surprised', vars)
  const leader = a.score > b.score ? a : b
  const trailer = leader === a ? b : a
  if (leader.score - trailer.score <= 8) return say(s, 'roundWrapClose', 'excited', vars)
  say(s, 'roundWrapLead', 'happy', { ...vars, leader: leader.name, trailer: trailer.name })
}

function navigate(s: GameState, screen: Screen) {
  s.screen = screen
  s.paused = false
  const lines: Partial<Record<Screen, [HostEvent, Mood]>> = {
    home: ['home', 'happy'],
    setup: ['setupP1', 'happy'],
    create: ['create', 'happy'],
    join: ['join', 'neutral'],
    lobby: ['lobby', 'smug'],
  }
  const line = lines[screen]
  if (line) say(s, line[0], line[1], { p1: s.players[0].name, p2: s.players[1].name })
}

function startMatch(s: GameState) {
  resetScores(s)
  s.screen = 'intro'
  say(s, 'intro', 'excited', { p1: s.players[0].name, p2: s.players[1].name, rounds: cap(numberWord(ROUNDS.length)) })
  emit(s, 'sfx', 'sting')
}

function timeShift(s: GameState, by: number) {
  const r = s.round
  if (!r) return
  const add = (v: number | null) => (v === null ? null : v + by)
  r.nextAt = add(r.nextAt)
  r.deadline = add(r.deadline)
  r.frozenAt = add(r.frozenAt)
  r.startedAt += by
  r.phaseStart += by
  r.bot = r.bot.map((b) => (b ? { ...b, at: b.at + by } : null)) as RoundState['bot']
}

/* ------------------------------ ticking ----------------------------- */

function tick(state: GameState, now: number, rand: number[]): GameState {
  const r = state.round
  if (!r || state.paused || state.screen !== 'round') return state

  if (r.phase === 'faceoff') {
    const due = ([0, 1] as PlayerId[]).filter((p) => r.bot[p] && !hasSub(r, p) && now >= r.bot[p]!.at)
    const expired = r.frozenAt === null && r.deadline !== null && now >= r.deadline
    const wrapUp = r.nextAt !== null && now >= r.nextAt
    if (!due.length && !expired && !wrapUp) return state
    const s = structuredClone(state)
    const sr = s.round!
    for (const p of due) if (sr.phase === 'faceoff' && !hasSub(sr, p)) lockFaceoff(s, p, sr.bot[p]!.text, now, rand)
    if (sr.nextAt !== null && now >= sr.nextAt) endFaceoff(s, now)
    else if (expired && sr.frozenAt === null) {
      autoLockDrafts(s, now, [0, 1])
      endFaceoff(s, now)
    }
    return s
  }

  if (r.phase === 'steal' && r.stealOpen) {
    const p = r.stealBy!
    const plan = r.bot[p]
    const botDue = plan && now >= plan.at
    const expired = r.deadline !== null && now >= r.deadline
    if (!botDue && !expired) return state
    const s = structuredClone(state)
    const sr = s.round!
    if (botDue) {
      lockSteal(s, p, plan.text, now)
      return s
    }
    const draft = sr.drafts[p].trim()
    if (draft && s.controllers[p] === 'human') lockSteal(s, p, draft, now, true)
    else {
      sr.stealOpen = false
      sr.frozenAt = now
      setPhase(sr, 'timeUp', now, now + 2400)
      say(s, 'stealTimeUp', 'sad', { name: name(s, p) })
      emit(s, 'sfx', 'timeup')
    }
    return s
  }

  if (r.nextAt !== null && now >= r.nextAt) {
    const s = structuredClone(state)
    advance(s, now, rand)
    return s
  }
  return state
}

function advance(s: GameState, now: number, rand: number[]) {
  const r = s.round!
  switch (r.phase) {
    case 'question':
      setPhase(r, 'countdown', now, now + COUNTDOWN_MS)
      return
    case 'countdown':
      return startFaceoff(s, now, rand)
    case 'reveal':
      return judge(s, now)
    case 'correct':
      return afterCorrect(s, now)
    case 'wrong':
      return afterWrong(s, now, rand)
    case 'steal': {
      const sub = r.queue.find((x) => x.player === r.stealBy)
      if (sub) {
        r.queue = r.queue.filter((x) => x !== sub)
        return startReveal(s, sub, true, now)
      }
      return toBoardReveal(s, now)
    }
    case 'late':
    case 'timeUp':
      return toBoardReveal(s, now)
    case 'boardReveal':
      return finishRound(s, now)
  }
}

/* ------------------------------ reducer ----------------------------- */

export function reducer(state: GameState, action: Action): GameState {
  const { now, rand } = action

  if (action.type === 'TICK') return tick(state, now, rand)

  const s = structuredClone(state)
  const r = s.round

  switch (action.type) {
    case 'NAV':
      navigate(s, action.screen)
      return s

    case 'HOST':
      say(s, action.event, action.mood, action.vars)
      return s

    case 'SET_PLAYER':
      s.players[action.id] = { ...s.players[action.id], name: tidy(action.name) || `Player ${action.id + 1}`, avatar: action.avatar }
      return s

    case 'SET_CONTROLLERS':
      s.controllers = action.controllers
      return s

    case 'SET_DIFFICULTY':
      s.difficulty = action.difficulty
      return s

    case 'START_MATCH':
    case 'REMATCH':
      startMatch(s)
      return s

    case 'PLAY_AGAIN':
      resetScores(s)
      navigate(s, 'lobby')
      return s

    case 'BEGIN_ROUND':
      beginRound(s, now)
      return s

    case 'DRAFT':
      if (!r || !(r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen))) return state
      r.drafts[action.player] = action.text
      return s

    case 'LOCK': {
      if (!r || !action.text.trim() || s.paused) return state
      if (r.phase === 'faceoff' && r.frozenAt === null && !hasSub(r, action.player)) {
        lockFaceoff(s, action.player, action.text, now, rand)
        return s
      }
      if (r.phase === 'steal' && r.stealOpen && r.stealBy === action.player) {
        lockSteal(s, action.player, action.text, now)
        return s
      }
      return state
    }

    case 'FREEZE': {
      const p = s.players[action.player]
      const open = r && r.deadline !== null && r.frozenAt === null && (r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen))
      if (!r || !open || p.freezeUsed) return state
      r.deadline = r.deadline! + 3000
      r.duration += 3000
      p.freezeUsed = true
      emit(s, 'sfx', 'freeze')
      return s
    }

    case 'CONTINUE': {
      if (!r || r.phase !== 'done') return state
      if (r.def.kind === 'sudden') {
        if (r.winner !== null) finishGame(s, r.winner)
        else if (s.sudden < SUDDEN_DEATH.length) {
          s.sudden += 1
          s.round = null
          s.screen = 'suddenIntro'
          say(s, 'suddenIntro', 'surprised')
          emit(s, 'sfx', 'sting')
        } else finishGame(s, 'draw')
        return s
      }
      roundWrap(s)
      s.screen = 'roundResult'
      return s
    }

    case 'AFTER_RESULT': {
      const [a, b] = s.players
      if (s.roundIndex >= ROUNDS.length - 1) {
        if (a.score === b.score) {
          s.sudden = 1
          s.round = null
          s.screen = 'suddenIntro'
          say(s, 'suddenIntro', 'surprised')
          emit(s, 'sfx', 'sting')
        } else finishGame(s, a.score > b.score ? 0 : 1)
        return s
      }
      s.screen = 'scoreboard'
      s.round = null
      say(s, 'scoreboard', 'happy', { nextWord: numberWord(s.roundIndex + 2) })
      return s
    }

    case 'AFTER_SCOREBOARD':
      s.roundIndex = Math.min(s.roundIndex + 1, ROUNDS.length - 1)
      if (ROUNDS[s.roundIndex].kind === 'final') {
        s.screen = 'finalIntro'
        say(s, 'finalIntro', 'smug')
        emit(s, 'sfx', 'sting')
      } else beginRound(s, now)
      return s

    case 'PAUSE':
      if (s.paused) return state
      s.paused = true
      s.pausedAt = now
      return s

    case 'RESUME':
      if (!s.paused) return state
      timeShift(s, now - (s.pausedAt ?? now))
      s.paused = false
      s.pausedAt = null
      return s

    case 'DEV':
      return dev(s, action, now, rand)
  }
  return state
}

/* ---------------------- prototype-only controls ---------------------- */

function devTarget(s: GameState): PlayerId {
  const r = s.round!
  if (r.phase === 'steal' && r.stealBy !== null) return r.stealBy
  const open = ([0, 1] as PlayerId[]).filter((p) => !hasSub(r, p))
  return open.find((p) => s.controllers[p] === 'human') ?? open[0] ?? 0
}

function ensureFaceoff(s: GameState, now: number, rand: number[]) {
  const r = s.round
  if (r && (r.phase === 'question' || r.phase === 'countdown')) startFaceoff(s, now, rand)
}

function dev(s: GameState, action: Action & { type: 'DEV' }, now: number, rand: number[]): GameState {
  s.paused = false
  s.pausedAt = null
  switch (action.cmd) {
    case 'correct':
    case 'wrong': {
      if (!s.round) return s
      ensureFaceoff(s, now, rand)
      const r = s.round
      const p = devTarget(s)
      const hidden = r.tiles.findIndex((t) => t.kind === 'hidden')
      const text =
        action.cmd === 'correct' && hidden >= 0 ? r.def.question.answers[hidden].text : r.def.question.decoys[0]
      if (r.phase === 'faceoff' && !hasSub(r, p)) lockFaceoff(s, p, text, now, rand)
      else if (r.phase === 'steal' && r.stealOpen) lockSteal(s, p, text, now)
      return s
    }
    case 'timeout': {
      const r = s.round
      if (r && r.frozenAt === null && (r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen))) r.deadline = now
      return s
    }
    case 'steal': {
      if (!s.round) return s
      ensureFaceoff(s, now, rand)
      const r = s.round
      if (r.phase !== 'faceoff') return s
      const target = devTarget(s)
      const opp = other(target)
      r.subs = [{ player: opp, text: r.def.question.decoys[0], at: 1800, match: null }]
      r.drafts[target] = ''
      endFaceoff(s, now)
      judge(s, now) // strike plays, then the normal flow opens the steal
      return s
    }
    case 'revealBoard': {
      const r = s.round
      if (r) r.tiles = r.tiles.map((t) => (t.kind === 'hidden' ? { ...t, kind: 'board' } : t))
      return s
    }
    case 'final':
      s.roundIndex = ROUNDS.length - 1
      s.sudden = 0
      s.round = null
      s.screen = 'finalIntro'
      say(s, 'finalIntro', 'smug')
      emit(s, 'sfx', 'sting')
      return s
    case 'tie': {
      const v = Math.max(s.players[0].score, s.players[1].score, 24)
      s.players[0].score = v
      s.players[1].score = v
      s.roundIndex = ROUNDS.length - 1
      s.sudden = 1
      s.round = null
      s.screen = 'suddenIntro'
      say(s, 'suddenIntro', 'surprised')
      emit(s, 'sfx', 'sting')
      return s
    }
    case 'p1wins':
    case 'p2wins': {
      const w: PlayerId = action.cmd === 'p1wins' ? 0 : 1
      s.players[w].score = Math.max(27, s.players[other(w)].score + 4)
      s.players[other(w)].score = Math.min(s.players[other(w)].score || 23, s.players[w].score - 4)
      finishGame(s, w)
      return s
    }
    case 'jump': {
      const to = action.screen ?? 'home'
      if (to === 'round') beginRound(s, now)
      else if (to === 'intro') startMatch(s)
      else if (to === 'result') {
        const [a, b] = s.players
        finishGame(s, a.score === b.score ? 'draw' : a.score > b.score ? 0 : 1)
      } else if (to === 'finalIntro') return dev(s, { ...action, cmd: 'final' }, now, rand)
      else if (to === 'suddenIntro') return dev(s, { ...action, cmd: 'tie' }, now, rand)
      else navigate(s, to)
      return s
    }
  }
  return s
}
