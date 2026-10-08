// The host's voice.
//
// The real voice is ElevenLabs, generated and cached by the game server and
// delivered as audio, so no key or provider ever touches the browser. The
// browser's own speech synthesis is the fallback, used when the server's voice
// is switched off, over its daily budget, or has just failed. Either way the
// game carries on; a silent host is never a reason to stall a round.

import { api } from '@/api/client'

type Listener = (speaking: boolean) => void
const listeners = new Set<Listener>()
let chosen: SpeechSynthesisVoice | null = null

const browserSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

function notify(v: boolean) {
  listeners.forEach((l) => l(v))
}

/* ------------------------------ the server's voice ------------------------------ */

/** How a line should be delivered. `show` is for the set pieces. */
export interface Delivery {
  personality: string
  show: boolean
}

let audio: HTMLAudioElement | null = null
/** Bumped for every new line, so audio that arrives late for an old one is dropped. */
let current = 0
let offUntil = 0
let failures = 0
let known: 'unknown' | 'on' | 'off' = 'unknown'
const urls = new Map<string, string>()

const serverUsable = () => known !== 'off' && Date.now() >= offUntil

function pauseServerVoiceFor(ms: number) {
  offUntil = Date.now() + ms
}

async function audioFor(text: string, d: Delivery): Promise<string | null> {
  const key = `${d.show ? 's' : 'q'}|${d.personality}|${text}`
  const have = urls.get(key)
  if (have) return have
  // Before the player is signed in there is nobody to speak to: use the browser.
  if (!api.isAuthenticated) return null
  try {
    if (known === 'unknown') {
      const status = await api.voiceStatus()
      known = status.enabled ? 'on' : 'off'
      if (!status.enabled) return null
    }
    const blob = await api.voice(text, d.show ? 'show' : 'quick', d.personality)
    failures = 0
    const url = URL.createObjectURL(blob)
    if (urls.size > 120) {
      const oldest = urls.keys().next().value
      if (oldest !== undefined) {
        URL.revokeObjectURL(urls.get(oldest)!)
        urls.delete(oldest)
      }
    }
    urls.set(key, url)
    return url
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'voice_disabled') known = 'off'
    else if (code === 'voice_budget') pauseServerVoiceFor(10 * 60_000)
    else if (++failures >= 3) {
      failures = 0
      pauseServerVoiceFor(2 * 60_000)
    }
    return null
  }
}

async function playServerVoice(text: string, d: Delivery, mine: number): Promise<boolean> {
  const url = await audioFor(text, d)
  if (current !== mine) return true // a newer line took over; nothing to fall back to
  if (!url) return false
  const el = new Audio(url)
  audio = el
  el.onplaying = () => current === mine && notify(true)
  el.onended = () => current === mine && notify(false)
  el.onerror = () => current === mine && notify(false)
  try {
    await el.play()
    return true
  } catch {
    // Most often the browser refusing sound before the player has tapped anything.
    return false
  }
}

/* ----------------------------- the browser's voice ----------------------------- */

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen
  const voices = window.speechSynthesis.getVoices()
  const preferred = ['Google US English', 'Samantha', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Guy', 'Daniel', 'Karen']
  chosen =
    preferred.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  return chosen
}

function speakWithBrowser(text: string, opts: { rate: number; pitch: number }, mine: number) {
  if (!browserSupported() || current !== mine) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const voice = pickVoice()
  if (voice) u.voice = voice
  u.rate = opts.rate
  u.pitch = opts.pitch
  u.onstart = () => current === mine && notify(true)
  u.onend = () => current === mine && notify(false)
  u.onerror = () => current === mine && notify(false)
  synth.speak(u)
}

/* ------------------------------------ public ------------------------------------ */

function halt() {
  if (audio) {
    audio.onplaying = audio.onended = audio.onerror = null
    audio.pause()
    audio = null
  }
  if (browserSupported()) window.speechSynthesis.cancel()
}

/** Say a line, replacing whatever is being said. */
export function speak(text: string, opts: { rate: number; pitch: number }, delivery?: Delivery) {
  const mine = ++current
  halt()
  if (delivery && serverUsable()) {
    void playServerVoice(text, delivery, mine).then((ok) => {
      if (!ok && current === mine) speakWithBrowser(text, opts, mine)
    })
    return
  }
  speakWithBrowser(text, opts, mine)
}

export function stopSpeaking() {
  current += 1
  halt()
  notify(false)
}

export function onSpeaking(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

if (browserSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    chosen = null
  }
}
