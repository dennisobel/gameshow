// Shapes returned by the Go API. Kept hand-written and small: these are the
// only fields the client actually uses.

export interface ApiUser {
  id: string
  email?: string
  displayName: string
  avatar: number
  isGuest: boolean
  role: 'player' | 'editor' | 'admin'
}

export interface Session {
  user: ApiUser
  accessToken: string
  expiresAt: string
  refreshToken: string
}

export interface ApiCategory {
  slug: string
  name: string
  tagline: string
  icon: string
  accent: string
  locale: string
  questionCount: number
}

/** A board slot before it is won: how much it is worth, but not what it says. */
export interface ApiSlot {
  rank: number
  points: number
}

export interface ApiRound {
  round: number
  questionId: string
  prompt: string
  kind: 'normal' | 'double' | 'final' | 'sudden'
  multiplier: number
  seconds: number
  difficulty: string
  panelSize: number
  slots: ApiSlot[]
}

export interface ApiGame {
  code: string
  title: string
  category: ApiCategory
  rounds: ApiRound[]
  plays: number
  createdAt: string
}

/** A live room, as anyone holding its code may see it before joining. */
export interface ApiRoomPeek {
  code: string
  mode: 'live' | 'bot'
  status: 'open' | 'full' | 'playing' | 'finished'
  category: { slug: string; name: string }
  host: { name: string; avatar: number }
  rounds: number
}

/** The ticket that lets one browser tab hold one seat in a room. */
export interface ApiRoomTicket {
  code: string
  seat: number
  token: string
  mode: 'live' | 'bot'
}

export interface ApiLeaderRow {
  name: string
  avatar: number
  best: number
  played: number
  won: number
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** True when the request failed because the API could not be reached at all,
   *  which is what puts the app into offline mode. */
  get isOffline() {
    return this.status === 0
  }
}
