// Host voice via the Web Speech API. Degrades silently where unsupported.

type Listener = (speaking: boolean) => void
const listeners = new Set<Listener>()
let chosen: SpeechSynthesisVoice | null = null

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

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

function notify(v: boolean) {
  listeners.forEach((l) => l(v))
}

export function speak(text: string, opts: { rate: number; pitch: number }) {
  if (!supported()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const voice = pickVoice()
  if (voice) u.voice = voice
  u.rate = opts.rate
  u.pitch = opts.pitch
  u.onstart = () => notify(true)
  u.onend = () => notify(false)
  u.onerror = () => notify(false)
  synth.speak(u)
}

export function stopSpeaking() {
  if (!supported()) return
  window.speechSynthesis.cancel()
  notify(false)
}

export function onSpeaking(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

if (supported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    chosen = null
  }
}
