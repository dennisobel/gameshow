import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { reducer, initialState, type Difficulty, type GameState, type Input, type PlayerId } from './machine'
import { hostLine, VOICE_TUNING, type Personality } from './host'
import { music, sfx, unlockAudio, type SfxName } from '@/lib/sound'
import { onSpeaking, speak, stopSpeaking } from '@/lib/voice'
import { vibrate } from '@/lib/utils'

export interface Settings {
  hostVoice: boolean
  captions: boolean
  sound: boolean
  music: boolean
  haptics: boolean
  personality: Personality
  difficulty: Difficulty
  language: 'en' | 'sw' | 'mix'
  largeText: boolean
  highContrast: boolean
  reduceMotion: boolean
}

export type Overlay = null | 'settings' | 'dev' | 'leaderboard' | 'daily' | 'share' | 'about'

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
  /** The player this device is "looking through" (first human, else Player 1). */
  me: PlayerId
  devEnabled: boolean
}

const GameContext = createContext<GameContextValue | null>(null)

const randoms = () => Array.from({ length: 10 }, Math.random)

const OPPONENT_REPLIES = ['😎', '🔥', '👀', 'Too easy.', "You're cooked.", 'I knew that one.', '😂']

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [overlay, setOverlayState] = useState<Overlay>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [audience, setAudience] = useState<AudienceBurst[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [voiceOn, setVoiceOn] = useState(false)
  const [typing, setTyping] = useState(false)
  const seq = useRef(0)
  const lastFx = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const act = useCallback((input: Input) => {
    dispatch({ ...input, now: Date.now(), rand: randoms() })
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
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600)
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

  const stateRef = useRef(state)
  stateRef.current = state

  const react = useCallback(
    (player: PlayerId, content: string) => {
      pushReaction(player, content)
      play('tap')
      // Simulated opponent sometimes answers back.
      const opp: PlayerId = player === 0 ? 1 : 0
      if (stateRef.current.controllers[opp] === 'bot' && Math.random() < 0.6) {
        const reply = OPPONENT_REPLIES[Math.floor(Math.random() * OPPONENT_REPLIES.length)]
        window.setTimeout(() => pushReaction(opp, reply), 900 + Math.random() * 900)
      }
    },
    [play, pushReaction],
  )

  const setOverlay = useCallback(
    (o: Overlay) => {
      unlockAudio()
      setOverlayState(o)
      // Opening settings mid-round pauses the clock.
      if (stateRef.current.screen === 'round') act({ type: o === 'settings' || o === 'about' ? 'PAUSE' : 'RESUME' })
    },
    [act],
  )

  // Game clock.
  useEffect(() => {
    if (state.screen !== 'round') return
    const id = window.setInterval(() => act({ type: 'TICK' }), 100)
    return () => window.clearInterval(id)
  }, [state.screen, act])

  // Keep the bot difficulty in sync with settings.
  useEffect(() => {
    if (state.difficulty !== settings.difficulty) act({ type: 'SET_DIFFICULTY', difficulty: settings.difficulty })
  }, [settings.difficulty, state.difficulty, act])

  // Play emitted effects.
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
    if (s.hostVoice) {
      const r = stateRef.current.round
      const reading = ['roundIntro', 'doubleIntro', 'finalQuestion', 'suddenQuestion'].includes(state.host.event)
      speak(reading && r ? `${line} ${r.def.question.prompt}` : line, VOICE_TUNING[s.personality])
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

  // Hidden prototype panel: Shift+D or the backtick key; `?dev` shows a launcher chip.
  const devEnabled = useMemo(() => new URLSearchParams(window.location.search).has('dev'), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      if (e.key === '`' || (e.shiftKey && e.key.toLowerCase() === 'd')) {
        e.preventDefault()
        setOverlayState((o) => (o === 'dev' ? null : 'dev'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const me: PlayerId = state.controllers[0] === 'human' ? 0 : state.controllers[1] === 'human' ? 1 : 0

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
    me,
    devEnabled,
  }
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used inside GameProvider')
  return ctx
}
