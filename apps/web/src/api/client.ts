import {
  ApiError,
  type ApiCategory,
  type ApiGame,
  type ApiLeaderRow,
  type ApiRoomPeek,
  type ApiRoomTicket,
  type ApiUser,
  type Session,
} from './types'

// Empty means same origin, which is how the app is served in Docker: nginx
// proxies /v1 to the API, so there is no CORS and the refresh cookie works.
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

const STORAGE_KEY = 'otb-session-v1'

interface StoredSession {
  user: ApiUser
  accessToken: string
  expiresAt: string
  refreshToken: string
}

function loadStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function saveStored(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode, or storage disabled */
  }
}

type Listener = (user: ApiUser | null) => void

/**
 * Typed client for the Go API.
 *
 * Owns the access token and refreshes it transparently: a caller never sees a
 * 401 caused by nothing worse than time passing. One refresh runs at a time,
 * so a burst of requests during a round cannot start a stampede of rotations
 * and trip the token-reuse detector.
 */
class ApiClient {
  private session: StoredSession | null = loadStored()
  private refreshing: Promise<boolean> | null = null
  private listeners = new Set<Listener>()

  get user(): ApiUser | null {
    return this.session?.user ?? null
  }

  get isAuthenticated() {
    return this.session !== null
  }

  onUserChange(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setSession(session: StoredSession | null) {
    this.session = session
    saveStored(session)
    this.listeners.forEach((l) => l(session?.user ?? null))
  }

  // ------------------------------------------------------------- transport

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auth?: boolean; retry?: boolean } = {},
  ): Promise<T> {
    const { auth = true, retry = true } = opts
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (auth && this.session) headers.Authorization = `Bearer ${this.session.accessToken}`

    let response: Response
    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      // Network-level failure: the caller treats this as "play offline".
      throw new ApiError(0, 'offline', 'Could not reach the game server.')
    }

    if (response.status === 401 && auth && retry && this.session) {
      if (await this.refresh()) {
        return this.request<T>(method, path, body, { auth, retry: false })
      }
      this.setSession(null)
    }

    if (response.status === 204) return undefined as T

    const text = await response.text()
    const payload = text ? safeParse(text) : null

    if (!response.ok) {
      const err = (payload ?? {}) as { error?: string; message?: string; field?: string }
      throw new ApiError(
        response.status,
        err.error ?? 'error',
        err.message ?? `Request failed (${response.status})`,
        err.field,
      )
    }
    return payload as T
  }

  private async refresh(): Promise<boolean> {
    // Collapse concurrent refreshes: presenting the same refresh token twice
    // looks like a stolen token and revokes the whole family.
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const session = await this.request<Session>(
            'POST',
            '/v1/auth/refresh',
            { refreshToken: this.session?.refreshToken ?? '' },
            { auth: false, retry: false },
          )
          this.setSession(session)
          return true
        } catch {
          return false
        } finally {
          this.refreshing = null
        }
      })()
    }
    return this.refreshing
  }

  // ------------------------------------------------------------------ auth

  /** Make sure there is a usable session, creating a guest if needed. */
  async ensureSession(displayName = 'Player', avatar = 0): Promise<ApiUser> {
    if (this.session) {
      try {
        const user = await this.request<ApiUser>('GET', '/v1/me')
        this.setSession({ ...this.session, user })
        return user
      } catch (err) {
        if (err instanceof ApiError && err.isOffline) throw err
        this.setSession(null)
      }
    }
    const session = await this.request<Session>(
      'POST',
      '/v1/auth/guest',
      { displayName, avatar },
      { auth: false },
    )
    this.setSession(session)
    return session.user
  }

  async register(email: string, password: string, displayName: string, avatar = 0) {
    const session = await this.request<Session>('POST', '/v1/auth/register', {
      email,
      password,
      displayName,
      avatar,
    })
    this.setSession(session)
    return session.user
  }

  async login(email: string, password: string) {
    const session = await this.request<Session>(
      'POST',
      '/v1/auth/login',
      { email, password },
      { auth: false },
    )
    this.setSession(session)
    return session.user
  }

  async logout() {
    try {
      await this.request<void>('POST', '/v1/auth/logout', {
        refreshToken: this.session?.refreshToken ?? '',
      })
    } catch {
      /* logging out locally is what matters */
    }
    this.setSession(null)
  }

  async updateProfile(displayName: string, avatar: number) {
    const user = await this.request<ApiUser>('PATCH', '/v1/me', { displayName, avatar })
    if (this.session) this.setSession({ ...this.session, user })
    return user
  }

  // --------------------------------------------------------------- content

  async categories() {
    const { categories } = await this.request<{ categories: ApiCategory[] }>(
      'GET',
      '/v1/categories',
      undefined,
      { auth: false },
    )
    return categories
  }

  game(code: string) {
    return this.request<ApiGame>('GET', `/v1/games/${encodeURIComponent(code)}`, undefined, {
      auth: false,
    })
  }

  // ----------------------------------------------------------------- rooms

  /** Open a room: a game with a friend, or one against the computer. */
  createRoom(body: {
    category?: string
    gameCode?: string
    name: string
    avatar: number
    bot: boolean
    difficulty: string
  }) {
    return this.request<ApiRoomTicket>('POST', '/v1/rooms', body)
  }

  peekRoom(code: string) {
    return this.request<ApiRoomPeek>('GET', `/v1/rooms/${encodeURIComponent(code)}`, undefined, {
      auth: false,
    })
  }

  joinRoom(code: string, body: { name: string; avatar: number }) {
    return this.request<ApiRoomTicket>('POST', `/v1/rooms/${encodeURIComponent(code)}/join`, body)
  }

  async leaderboard() {
    const { leaderboard } = await this.request<{ leaderboard: ApiLeaderRow[] }>(
      'GET',
      '/v1/leaderboard',
      undefined,
      { auth: false },
    )
    return leaderboard
  }

  sendFeedback(body: {
    questionId?: string
    matchId?: string
    kind: 'question_rating' | 'answer_missing' | 'bug' | 'report'
    value?: number
    note?: string
  }) {
    return this.request<void>('POST', '/v1/feedback', body)
  }

  voiceStatus() {
    return this.request<{ enabled: boolean; remaining?: number }>('GET', '/v1/voice/status', undefined, { auth: false })
  }

  /** The host saying a line, as audio. Cached on the server after the first time. */
  async voice(text: string, style: 'quick' | 'show', personality: string): Promise<Blob> {
    const path = `/v1/voice?style=${style}&p=${encodeURIComponent(personality)}&text=${encodeURIComponent(text)}`
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try {
        response = await fetch(`${BASE}${path}`, {
          headers: this.session ? { Authorization: `Bearer ${this.session.accessToken}` } : {},
          credentials: 'include',
        })
      } catch {
        throw new ApiError(0, 'offline', 'Could not reach the game server.')
      }
      if (response.status === 401 && attempt === 0 && this.session && (await this.refresh())) continue
      if (!response.ok) {
        const err = (safeParse(await response.text()) ?? {}) as { error?: string; message?: string }
        throw new ApiError(response.status, err.error ?? 'error', err.message ?? 'The host could not speak.')
      }
      return response.blob()
    }
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.')
  }

  health() {
    return this.request<{ status: string }>('GET', '/healthz', undefined, { auth: false })
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const api = new ApiClient()
export { ApiError }
