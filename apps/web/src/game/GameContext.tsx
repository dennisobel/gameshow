import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { reducer, initialState, type GameState, type Input, type PlayerId, type Profile } from './machine'
import { hostLine, VOICE_TUNING, type Personality } from './host'
import { music, sfx, unlockAudio, type SfxName } from '@/lib/sound'
import { onSpeaking, speak, stopSpeaking } from '@/lib/voice'
import { vibrate } from '@/lib/utils'
import { api, ApiError } from '@/api/client'
import type { ApiCategory, ApiGame, ApiRoomPeek } from '@/api/types'
import { LiveConnection, loadTicket, saveTicket, type LiveStatus, type Ticket } from './live'

export interface Settings {
  hostVoice: boolean
  captions: boolean
  sound: boolean
  music: boolean
  haptics: boolean
  personality: Personality
  /** How well the computer plays when you choose to play against it. */
  difficulty: 'easy' | 'medium' | 'hard' | 'insane'
  language: 'en' | 'sw' | 'mix'
  largeText: boolean
  highContrast: boolean
  reduceMotion: boolean
}

export type Overlay = null | 'settings' | 'leaderboard' | 'share' | 'about'

export interface AudienceBurst {
  id: number
  kind: string
}

export interface Reaction {
  id: number
  player: PlayerId
  content: string
}

const STORAGE_KEY = 'otb-settings-v1'
const PROFILE_KEY = 'otb-profile-v1'

function loadSettings(): Settings {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const defaults: Settings = {
    hostVoice: true,
    captions: true,
    sound: true,
    music: true,
    haptics: true,
    personality: 'funny',
    difficulty: 'medium',
    language: 'en',
    largeText: false,
    highContrast: false,
    reduceMotion: Boolean(reduce),
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults
  } catch {
    return defaults
  }
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>
      return { name: String(p.name ?? '').slice(0, 16), avatar: Number(p.avatar ?? 0) || 0 }
    }
  } catch {
    /* fall through */
  }
  return { name: '', avatar: 0 }
}

/** A board someone shared with /g/CODE: same questions, played in a new room. */
export interface SharedGame {
  code: string
  title: string
  rounds: number
}

export type CloseReason = string

interface GameContextValue {
  state: GameState
  act: (input: Input) => void
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  line: string
  talking: boolean
  overlay: Overlay
  setOverlay: (o: Overlay) => void
  toast: { id: number; text: string } | null
  showToast: (text: string) => void
  audience: AudienceBurst[]
  reactions: Reaction[]
  react: (player: PlayerId, content: string) => void
  play: (name: SfxName) => void
  buzz: (name: string) => void
  /** Which player this phone is. Always the first one: you are on the left. */
  me: PlayerId

  /** Who this phone's player is, remembered between visits. */
  profile: Profile
  saveProfile: (p: Profile) => void

  /** The game server. `ready` once it has answered; `apiError` if it cannot. */
  ready: boolean
  apiError: string | null
  retry: () => void
  categories: ApiCategory[]
  selectedCategory: string | null
  setSelectedCategory: (slug: string) => void

  /** The live connection to the room this phone is in. */
  link: LiveStatus
  createRoom: (opts: { bot: boolean; name: string; avatar: number }) => Promise<boolean>
  joinRoom: (code: string, who: Profile) => Promise<boolean>
  peekRoom: (code: string) => Promise<ApiRoomPeek | null>
  leaveRoom: () => void
  sharedGame: SharedGame | null
  loadShared: (code: string) => Promise<ApiGame | null>
  clearShared: () => void

  /** Things a player can do in a match. The server decides what they mean. */
  startMatch: () => void
  lockAnswer: (text: string) => void
  sendTyping: () => void
  freezeClock: () => void
  requestRematch: () => void
  decide: (choice: 'wait' | 'bot' | 'leave') => void
  setLevel: (level: Settings['difficulty']) => void

  /** What this player has typed for the current question. Local until locked. */
  draft: string
  setDraft: (text: string) => void
}

/** Lines that are only captions. Each unique line is paid for once, so the chatter
 *  around setting up (which names the players, so it is rarely the same twice) is
 *  left unspoken; the host speaks from the welcome onward. */
const CAPTION_ONLY = new Set(['home', 'setupP1', 'setupP2', 'create', 'join', 'lobby'])

/** The set pieces get the expressive voice; everything said mid-round the fast one. */
const SHOW_LINES = new Set(['intro', 'finalIntro', 'finalQuestion', 'suddenIntro', 'suddenQuestion', 'doubleIntro', 'winner', 'loser', 'draw'])

const GameContext = createContext<GameContextValue | null>(null)

const CLOSE_MESSAGES: Record<string, string | null> = {
  host_left: 'The host left, so the game ended.',
  abandoned: 'That game ended because nobody was in it.',
  expired: 'That game timed out waiting to start.',
  finished: 'That game is over.',
  server_stopping: 'The game server is restarting. Please start a new game.',
  left: null,
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return err.isOffline ? 'Could not reach the game server.' : err.message
  return 'Something went wrong. Please try again.'
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [state, dispatch] = useReducer(reducer, profile, initialState)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [overlay, setOverlayState] = useState<Overlay>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [audience, setAudience] = useState<AudienceBurst[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [voiceOn, setVoiceOn] = useState(false)
  const [typing, setTyping] = useState(false)
  const [ready, setReady] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [link, setLink] = useState<LiveStatus>('idle')
  const [sharedGame, setSharedGame] = useState<SharedGame | null>(null)
  const [draftState, setDraftState] = useState({ key: '', text: '' })
  const seq = useRef(0)
  const lastFx = useRef(0)
  const catchUp = useRef(true)
  const conn = useRef<LiveConnection | null>(null)
  const lastTypingSent = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const stateRef = useRef(state)
  stateRef.current = state
  const sharedRef = useRef(sharedGame)
  sharedRef.current = sharedGame

  const act = useCallback((input: Input) => {
    dispatch({ ...input, now: Date.now() })
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }, [])

  const saveProfile = useCallback(
    (p: Profile) => {
      const clean = { name: p.name.trim().replace(/\s+/g, ' ').slice(0, 16), avatar: p.avatar }
      setProfile(clean)
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(clean))
      } catch {
        /* storage unavailable */
      }
      act({ type: 'SET_PLAYER', name: clean.name, avatar: clean.avatar })
    },
    [act],
  )

  const play = useCallback((name: SfxName) => {
    if (settingsRef.current.sound) sfx[name]()
  }, [])
  const buzz = useCallback((name: string) => {
    if (settingsRef.current.haptics) vibrate(name)
  }, [])

  const showToast = useCallback((text: string) => {
    seq.current += 1
    const id = seq.current
    setToast({ id, text })
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3200)
  }, [])

  const addAudience = useCallback((kind: string) => {
    seq.current += 1
    const id = seq.current
    setAudience((a) => [...a.slice(-4), { id, kind }])
    window.setTimeout(() => setAudience((a) => a.filter((x) => x.id !== id)), 1900)
  }, [])

  const pushReaction = useCallback((player: PlayerId, content: string) => {
    seq.current += 1
    const id = seq.current
    setReactions((r) => [...r.slice(-6), { id, player, content }])
    window.setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2400)
  }, [])

  const react = useCallback(
    (player: PlayerId, content: string) => {
      pushReaction(player, content)
      play('tap')
      conn.current?.send({ t: 'react', e: content })
    },
    [play, pushReaction],
  )

  /* ------------------------------------------------------------- the room */

  const leaveLocal = useCallback(() => {
    conn.current?.close()
    conn.current = null
    saveTicket(null)
    setLink('idle')
    act({ type: 'LEAVE' })
  }, [act])

  const attach = useCallback(
    (ticket: Ticket) => {
      conn.current?.close()
      catchUp.current = true
      saveTicket(ticket)
      const c = new LiveConnection(ticket, {
        onState: (view, room, offset) => {
          // The first picture after connecting may carry effects that already
          // played; mark them seen so a reconnect does not replay the show.
          if (catchUp.current) {
            lastFx.current = view.fxSeq
            catchUp.current = false
          }
          dispatch({ type: 'SYNC', view, room, offset, now: Date.now() })
        },
        onStatus: (s) => {
          if (s === 'reconnecting') catchUp.current = true
          setLink(s)
        },
        onTyping: (until) => dispatch({ type: 'OPPONENT_TYPING', until, now: Date.now() }),
        onReaction: (e) => {
          pushReaction(1, e)
          play('tap')
        },
        onError: (code, message) => {
          showToast(message)
          if (code === 'bad_token' || code === 'closed' || code === 'seat_taken') {
            window.setTimeout(() => {
              if (conn.current === c) leaveLocal()
            }, 0)
          }
        },
        onClosed: (reason) => {
          const text = reason in CLOSE_MESSAGES ? CLOSE_MESSAGES[reason] : 'The game ended.'
          if (text) showToast(text)
          window.setTimeout(() => {
            if (conn.current === c) leaveLocal()
          }, 0)
        },
      })
      conn.current = c
      c.connect()
    },
    [leaveLocal, play, pushReaction, showToast],
  )

  const leaveRoom = useCallback(() => {
    conn.current?.leave()
    conn.current = null
    saveTicket(null)
    setLink('idle')
    act({ type: 'LEAVE' })
  }, [act])

  // Close the socket if the page goes away.
  useEffect(() => () => conn.current?.close(), [])

  /* -------------------------------------------------------------- the API */

  const connect = useCallback(async () => {
    setApiError(null)
    try {
      await api.ensureSession('Player', 0)
      const cats = await api.categories()
      setCategories(cats)
      setSelectedCategory((current) => current ?? cats[0]?.slug ?? null)
      setReady(true)
    } catch (err) {
      setReady(false)
      setApiError(describe(err))
    }
  }, [])

  useEffect(() => {
    void connect()
  }, [connect])

  // A page reload in the middle of a game puts the player straight back in it.
  useEffect(() => {
    const ticket = loadTicket()
    if (ticket) attach(ticket)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createRoom = useCallback(
    async ({ bot, name, avatar }: { bot: boolean; name: string; avatar: number }): Promise<boolean> => {
      if (!name.trim()) {
        showToast('Tell the host what to call you first.')
        return false
      }
      try {
        const shared = sharedRef.current
        const ticket = await api.createRoom({
          category: shared ? undefined : selectedCategory ?? undefined,
          gameCode: shared?.code,
          name,
          avatar,
          bot,
          difficulty: settingsRef.current.difficulty,
        })
        setSharedGame(null)
        attach(ticket)
        return true
      } catch (err) {
        showToast(describe(err))
        return false
      }
    },
    [attach, selectedCategory, showToast],
  )

  const joinRoom = useCallback(
    async (code: string, who: Profile): Promise<boolean> => {
      if (!who.name.trim()) {
        showToast('Tell the host what to call you first.')
        return false
      }
      try {
        const ticket = await api.joinRoom(code, { name: who.name, avatar: who.avatar })
        attach(ticket)
        return true
      } catch (err) {
        showToast(describe(err))
        return false
      }
    },
    [attach, showToast],
  )

  const peekRoom = useCallback(async (code: string): Promise<ApiRoomPeek | null> => {
    try {
      return await api.peekRoom(code)
    } catch {
      return null
    }
  }, [])

  const loadShared = useCallback(async (code: string): Promise<ApiGame | null> => {
    try {
      const game = await api.game(code)
      setSharedGame({ code: game.code, title: game.category.name || game.title, rounds: game.rounds.length })
      return game
    } catch {
      return null
    }
  }, [])

  /* ------------------------------------------------------ match actions */

  const startMatch = useCallback(() => conn.current?.send({ t: 'start' }), [])
  const lockAnswer = useCallback((text: string) => conn.current?.send({ t: 'lock', text }), [])
  const freezeClock = useCallback(() => conn.current?.send({ t: 'freeze' }), [])
  const requestRematch = useCallback(() => conn.current?.send({ t: 'rematch' }), [])
  const decide = useCallback((choice: 'wait' | 'bot' | 'leave') => conn.current?.send({ t: 'decide', choice }), [])
  const setLevel = useCallback(
    (level: Settings['difficulty']) => {
      updateSettings({ difficulty: level })
      conn.current?.send({ t: 'level', level })
    },
    [updateSettings],
  )
  const sendTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSent.current < 500) return
    lastTypingSent.current = now
    conn.current?.send({ t: 'typing' })
  }, [])

  const roundKey = state.round ? `${state.room?.code ?? ''}:${state.round.def.question.id}` : ''
  const draft = draftState.key === roundKey ? draftState.text : ''
  const setDraft = useCallback((text: string) => setDraftState({ key: roundKey, text }), [roundKey])

  const setOverlay = useCallback((o: Overlay) => {
    unlockAudio()
    setOverlayState(o)
    // A game against the computer can be paused while settings are open. A game
    // between two people cannot: nobody may stop the other player's clock.
    const s = stateRef.current
    if (s.room?.mode === 'bot' && s.screen === 'round') {
      conn.current?.send({ t: o === 'settings' || o === 'about' ? 'pause' : 'resume' })
    }
  }, [])

  /* ------------------------------------------------------- presentation */

  // Play the effects the server emitted, once each.
  useEffect(() => {
    for (const f of state.fx) {
      if (f.id <= lastFx.current) continue
      lastFx.current = f.id
      if (f.kind === 'sfx') play(f.name as SfxName)
      else if (f.kind === 'haptic') buzz(f.name)
      else if (f.kind === 'audience') {
        addAudience(f.name)
        if (f.name === 'cheer') play('applause')
        if (f.name === 'ooh') play('ooh')
      }
    }
  }, [state.fxSeq, state.fx, play, buzz, addAudience])

  // Resolve the host's current line for the chosen personality.
  const line = useMemo(
    () => hostLine(settings.personality, state.host.event, state.host.vars, state.host.key),
    [settings.personality, state.host],
  )

  // Host voice + "talking" animation window.
  useEffect(() => onSpeaking(setVoiceOn), [])
  useEffect(() => {
    setTyping(true)
    const id = window.setTimeout(() => setTyping(false), Math.min(4200, 500 + line.length * 42))
    const s = settingsRef.current
    if (s.hostVoice && !CAPTION_ONLY.has(state.host.event)) {
      const r = stateRef.current.round
      const reading = ['roundIntro', 'doubleIntro', 'finalQuestion', 'suddenQuestion'].includes(state.host.event)
      speak(reading && r ? `${line} ${r.def.question.prompt}` : line, VOICE_TUNING[s.personality], {
        personality: s.personality,
        show: SHOW_LINES.has(state.host.event),
      })
    }
    return () => window.clearTimeout(id)
    // Only a new host line (new key) should trigger speech.
  }, [state.host.key])

  useEffect(() => {
    if (!settings.hostVoice) stopSpeaking()
  }, [settings.hostVoice])

  // Tension bed while the clock runs.
  const r = state.round
  const tense =
    settings.music &&
    !state.paused &&
    state.screen === 'round' &&
    !!r &&
    r.frozenAt === null &&
    (r.phase === 'faceoff' || (r.phase === 'steal' && r.stealOpen))
  useEffect(() => {
    if (tense) music.start()
    else music.stop()
    return () => music.stop()
  }, [tense])

  const value: GameContextValue = {
    state,
    act,
    settings,
    updateSettings,
    line,
    talking: typing || voiceOn,
    overlay,
    setOverlay,
    toast,
    showToast,
    audience,
    reactions,
    react,
    play,
    buzz,
    me: 0,
    profile,
    saveProfile,
    ready,
    apiError,
    retry: () => void connect(),
    categories,
    selectedCategory,
    setSelectedCategory,
    link,
    createRoom,
    joinRoom,
    peekRoom,
    leaveRoom,
    sharedGame,
    loadShared,
    clearShared: () => setSharedGame(null),
    startMatch,
    lockAnswer,
    sendTyping,
    freezeClock,
    requestRematch,
    decide,
    setLevel,
    draft,
    setDraft,
  }
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used inside GameProvider')
  return ctx
}
