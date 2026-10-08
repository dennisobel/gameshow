// What the screens draw from.
//
// The match itself (the clock, the scoring, who was first) runs on the server.
// This file holds the shape of that state as a phone receives it, the few things
// that are local to one phone (which screen of the set-up flow it is on, its own
// profile), and the one rule for taking in a new picture from the server.

import type { RoundDef, RoundKind } from './questions'
import { type HostEvent, type HostVars, type Mood } from './host'
import type { LiveView, LiveRound, LiveSub, RoomInfo } from './wire'

export type PlayerId = 0 | 1
export type Controller = 'human' | 'bot'

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
  | 'reveal' // the first locked answer is shown
  | 'correct'
  | 'wrong' // strike
  | 'late' // the slower answer, shown after the round was decided
  | 'steal' // the other player gets a chance to steal
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
  /** Empty for the other player's answer until the reveal. */
  text: string
  /** ms after the answer window opened */
  at: number
  /** Board index this answer reached, known only once it is revealed. */
  match: number | null
  steal: boolean
}

export type TileKind = 'hidden' | 'won' | 'stolen' | 'late' | 'board'
export interface Tile {
  kind: TileKind
  by: PlayerId | null
  points: number
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
  current: Submission | null
  isSteal: boolean
  stealBy: PlayerId | null
  stealOpen: boolean
  tiles: Tile[]
  struck: PlayerId[]
  winner: PlayerId | null
  awarded: number
  streakBonus: boolean
  /** Local times: when a player's "typing" signal ends, and when it begins. */
  typingUntil: [number, number]
  typingFrom: [number, number]
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

/** What a round is worth, known before it is played. The questions are not. */
export interface DeckEntry {
  kind: RoundKind
  multiplier: number
  seconds: number
  top: number
}

export interface PauseInfo {
  reason: 'manual' | 'disconnect'
  /** Who is missing, as this phone counts players (0 is this phone's player). */
  seat: PlayerId
  until: number
  /** True when this player is the one being asked what to do. */
  decision: boolean
}

export interface GameState {
  screen: Screen
  players: [Player, Player]
  controllers: [Controller, Controller]
  seated: [boolean, boolean]
  connected: [boolean, boolean]
  roundIndex: number
  sudden: number
  round: RoundState | null
  history: RoundRecord[]
  host: HostState
  fx: Fx[]
  fxSeq: number
  deck: DeckEntry[]
  delta: { player: PlayerId; points: number; key: number } | null
  outcome: PlayerId | 'draw' | null
  paused: boolean
  pausedAt: number | null
  pause: PauseInfo | null
  rematch: [boolean, boolean]
  /** Set while this phone is in a room. */
  room: RoomInfo | null
  /** Local time at which the other player's "typing" signal runs out. */
  opponentTypingUntil: number
}

export interface Profile {
  name: string
  avatar: number
}

export type Input =
  | { type: 'NAV'; screen: Screen }
  | { type: 'HOST'; event: HostEvent; mood: Mood; vars?: HostVars }
  | { type: 'SET_PLAYER'; name: string; avatar: number }
  | { type: 'SYNC'; view: LiveView; room: RoomInfo; offset: number }
  | { type: 'OPPONENT_TYPING'; until: number }
  | { type: 'LEAVE' }

export type Action = Input & { now: number }

/* ------------------------------------------------------------------ */

const blankPlayer = (name: string, avatar: number): Player => ({ name, avatar, score: 0, streak: 0, freezeUsed: false })

export function initialState(profile: Profile = { name: '', avatar: 0 }): GameState {
  return {
    screen: 'home',
    players: [blankPlayer(profile.name, profile.avatar), blankPlayer('', 3)],
    controllers: ['human', 'human'],
    seated: [false, false],
    connected: [false, false],
    roundIndex: 0,
    sudden: 0,
    round: null,
    history: [],
    host: { event: 'home', vars: {}, mood: 'happy', key: 0 },
    fx: [],
    fxSeq: 0,
    deck: [],
    delta: null,
    outcome: null,
    paused: false,
    pausedAt: null,
    pause: null,
    rematch: [false, false],
    room: null,
    opponentTypingUntil: 0,
  }
}

/* ------------------------- taking in the server's picture ------------------------- */

const asPlayer = (n: number): PlayerId => (n === 1 ? 1 : 0)

function toSub(s: LiveSub): Submission {
  return { player: asPlayer(s.player), text: s.text, at: s.at, match: s.match, steal: s.steal }
}

/**
 * The server stamps everything with its own clock. Convert once, as the picture
 * arrives, so the rest of the app can keep using the phone's clock.
 */
function toRound(r: LiveRound, offset: number): RoundState {
  const local = (t: number | null) => (t === null || t === 0 ? null : t - offset)
  const typing = (t: number) => (t === 0 ? 0 : t - offset)
  return {
    def: r.def as RoundDef,
    number: r.number,
    phase: r.phase,
    phaseStart: r.phaseStart - offset,
    nextAt: local(r.nextAt),
    startedAt: r.startedAt - offset,
    deadline: local(r.deadline),
    duration: r.duration,
    frozenAt: local(r.frozenAt),
    subs: r.subs.map(toSub),
    current: r.current ? toSub(r.current) : null,
    isSteal: r.isSteal,
    stealBy: r.stealBy === null ? null : asPlayer(r.stealBy),
    stealOpen: r.stealOpen,
    tiles: r.tiles.map((t) => ({ kind: t.kind, by: t.by === null ? null : asPlayer(t.by), points: t.points })),
    struck: r.struck.map(asPlayer),
    winner: r.winner === null ? null : asPlayer(r.winner),
    awarded: r.awarded,
    streakBonus: r.streakBonus,
    typingUntil: [typing(r.typingUntil[0]), typing(r.typingUntil[1])],
    typingFrom: [typing(r.typingFrom[0]), typing(r.typingFrom[1])],
  }
}

function applyView(state: GameState, view: LiveView, room: RoomInfo, offset: number): GameState {
  return {
    ...state,
    screen: view.screen,
    players: view.players,
    controllers: view.controllers,
    seated: view.seated,
    connected: view.connected,
    roundIndex: view.roundIndex,
    sudden: view.sudden,
    round: view.round ? toRound(view.round, offset) : null,
    history: view.history.map((h) => ({
      number: h.number,
      kind: h.kind,
      winner: h.winner === null ? null : asPlayer(h.winner),
      points: h.points,
      answer: h.answer || null,
      stolen: h.stolen,
    })),
    host: view.host,
    fx: view.fx,
    fxSeq: view.fxSeq,
    deck: view.deck,
    delta: view.delta ? { ...view.delta, player: asPlayer(view.delta.player) } : null,
    outcome: view.outcome === null ? null : view.outcome === 'draw' ? 'draw' : asPlayer(view.outcome),
    paused: view.paused,
    pausedAt: view.pausedAt === null ? null : view.pausedAt - offset,
    pause: view.pause
      ? { reason: view.pause.reason, seat: asPlayer(view.pause.seat), until: view.pause.until - offset, decision: view.pause.decision }
      : null,
    rematch: view.rematch,
    room,
  }
}

/* ------------------------------ local screens ------------------------------ */

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 16)

function say(s: GameState, event: HostEvent, mood: Mood, vars: HostVars = {}) {
  s.host = { event, vars, mood, key: s.host.key + 1 }
}

/** The host's line for the screens that exist only on this phone. */
const LOCAL_LINES: Partial<Record<Screen, [HostEvent, Mood]>> = {
  home: ['home', 'happy'],
  setup: ['setupP1', 'happy'],
  create: ['create', 'happy'],
  join: ['join', 'neutral'],
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SYNC':
      return applyView(state, action.view, action.room, action.offset)

    case 'OPPONENT_TYPING':
      return { ...state, opponentTypingUntil: action.until }

    case 'NAV': {
      // The server decides what happens inside a match; this only moves between
      // the screens that come before one.
      if (state.room && action.screen !== 'home') return state
      const s = structuredClone(state)
      s.screen = action.screen
      const line = LOCAL_LINES[action.screen]
      if (line) say(s, line[0], line[1], { p1: s.players[0].name })
      return s
    }

    case 'HOST': {
      const s = structuredClone(state)
      say(s, action.event, action.mood, action.vars)
      return s
    }

    case 'SET_PLAYER': {
      const s = structuredClone(state)
      s.players[0] = { ...s.players[0], name: tidy(action.name) || s.players[0].name, avatar: action.avatar }
      return s
    }

    case 'LEAVE': {
      // Back to a clean home, keeping only who this player is.
      const fresh = initialState({ name: state.players[0].name, avatar: state.players[0].avatar })
      fresh.host = { ...fresh.host, key: state.host.key + 1 }
      return fresh
    }
  }
}
