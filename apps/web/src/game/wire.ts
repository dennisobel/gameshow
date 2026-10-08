// The shapes the game server sends over the WebSocket. They mirror api/internal/live
// (protocol.go and view.go); change one and the other has to change with it.

import type { HostEvent, HostVars, Mood } from './host'
import type { Phase, Screen, TileKind, DeckEntry } from './machine'
import type { RoundKind } from './questions'

export interface LiveSub {
  player: number
  text: string
  at: number
  match: number | null
  steal: boolean
}

export interface LiveTile {
  kind: TileKind
  by: number | null
  points: number
}

export interface LiveRound {
  def: {
    kind: RoundKind
    multiplier: number
    seconds: number
    question: { id: string; prompt: string; answers: { text: string; points: number; aliases: string[] }[]; decoys: string[] }
  }
  number: number
  phase: Phase
  phaseStart: number
  nextAt: number | null
  startedAt: number
  deadline: number | null
  duration: number
  frozenAt: number | null
  subs: LiveSub[]
  current: LiveSub | null
  isSteal: boolean
  stealBy: number | null
  stealOpen: boolean
  tiles: LiveTile[]
  struck: number[]
  winner: number | null
  awarded: number
  streakBonus: boolean
  typingUntil: [number, number]
  typingFrom: [number, number]
}

export interface LivePlayer {
  name: string
  avatar: number
  score: number
  streak: number
  freezeUsed: boolean
}

export interface LiveView {
  seq: number
  now: number
  screen: Screen
  players: [LivePlayer, LivePlayer]
  controllers: ['human' | 'bot', 'human' | 'bot']
  seated: [boolean, boolean]
  connected: [boolean, boolean]
  roundIndex: number
  sudden: number
  round: LiveRound | null
  history: { number: number; kind: RoundKind; winner: number | null; points: number; answer: string; stolen: boolean }[]
  host: { event: HostEvent; vars: HostVars; mood: Mood; key: number }
  fx: { id: number; kind: 'sfx' | 'haptic' | 'audience'; name: string }[]
  fxSeq: number
  deck: DeckEntry[]
  delta: { player: number; points: number; key: number } | null
  outcome: number | 'draw' | null
  paused: boolean
  pausedAt: number | null
  pause: { reason: 'manual' | 'disconnect'; seat: number; until: number; decision: boolean } | null
  rematch: [boolean, boolean]
}

export interface RoomInfo {
  code: string
  mode: 'live' | 'bot'
  /** Which seat this phone holds: 0 created the room. */
  me: number
  category: { slug: string; name: string }
  shareCode: string
  rounds: number
  difficulty: string
}

export type ServerMessage =
  | { t: 'state'; v: LiveView; room: RoomInfo }
  | { t: 'pong'; c: number; s: number }
  | { t: 'typing'; until: number }
  | { t: 'reaction'; e: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'closed'; reason: string }

export type ClientMessage =
  | { t: 'hello'; token: string }
  | { t: 'ping'; c: number }
  | { t: 'start' }
  | { t: 'typing' }
  | { t: 'lock'; text: string }
  | { t: 'freeze' }
  | { t: 'react'; e: string }
  | { t: 'rematch' }
  | { t: 'decide'; choice: 'wait' | 'bot' | 'leave' }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'level'; level: string }
  | { t: 'leave' }
