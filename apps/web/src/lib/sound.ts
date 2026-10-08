// Synthesised game-show sound kit (Web Audio). No audio files needed.

let ctx: AudioContext | null = null
let master: GainNode | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = 0.55
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

interface ToneOpts {
  freq: number
  type?: OscillatorType
  at?: number
  dur?: number
  gain?: number
  slideTo?: number
  attack?: number
}

function tone({ freq, type = 'sine', at = 0, dur = 0.15, gain = 0.2, slideTo, attack = 0.005 }: ToneOpts) {
  const c = audio()
  if (!c || !master) return
  const t = c.currentTime + at
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(master)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

let noiseBuffer: AudioBuffer | null = null
function noise({ at = 0, dur = 0.2, gain = 0.2, freq = 2000, q = 1, to }: { at?: number; dur?: number; gain?: number; freq?: number; q?: number; to?: number }) {
  const c = audio()
  if (!c || !master) return
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  const t = c.currentTime + at
  const src = c.createBufferSource()
  src.buffer = noiseBuffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(freq, t)
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(master)
  src.start(t)
  src.stop(t + dur + 0.05)
}

export const sfx = {
  tick: () => tone({ freq: 1250, type: 'square', dur: 0.05, gain: 0.06 }),
  tock: () => tone({ freq: 880, type: 'square', dur: 0.05, gain: 0.05 }),
  count: () => {
    tone({ freq: 440, type: 'triangle', dur: 0.22, gain: 0.25 })
    tone({ freq: 880, type: 'sine', dur: 0.18, gain: 0.08 })
  },
  go: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'sawtooth', at: i * 0.03, dur: 0.45, gain: 0.08 })),
  tap: () => tone({ freq: 620, slideTo: 900, dur: 0.06, gain: 0.06 }),
  pop: () => tone({ freq: 600, slideTo: 1300, dur: 0.14, gain: 0.14 }),
  lock: () => {
    tone({ freq: 160, type: 'square', dur: 0.09, gain: 0.12 })
    tone({ freq: 1200, type: 'triangle', at: 0.04, dur: 0.1, gain: 0.08 })
  },
  drumroll: () => {
    for (let i = 0; i < 38; i++) noise({ at: i * 0.05, dur: 0.05, gain: 0.03 + i * 0.004, freq: 220, q: 0.8 })
  },
  flip: () => noise({ dur: 0.18, gain: 0.12, freq: 1800, to: 6000, q: 0.7 }),
  correct: () => {
    noise({ dur: 0.18, gain: 0.1, freq: 1800, to: 6000, q: 0.7 })
    ;[880, 1320].forEach((f, i) => tone({ freq: f, at: 0.05 + i * 0.09, dur: 0.6, gain: 0.16 }))
    ;[659, 880, 1109, 1319].forEach((f, i) => tone({ freq: f, type: 'triangle', at: 0.28 + i * 0.07, dur: 0.3, gain: 0.08 }))
  },
  buzzer: () => {
    tone({ freq: 110, type: 'sawtooth', dur: 0.75, gain: 0.16, attack: 0.01 })
    tone({ freq: 116.5, type: 'sawtooth', dur: 0.75, gain: 0.16, attack: 0.01 })
    tone({ freq: 55, type: 'square', dur: 0.75, gain: 0.08, attack: 0.01 })
  },
  steal: () => {
    tone({ freq: 220, type: 'sawtooth', slideTo: 880, dur: 0.45, gain: 0.08 })
    tone({ freq: 1320, at: 0.42, dur: 0.4, gain: 0.1 })
  },
  cascade: () => [0, 1, 2, 3, 4].forEach((i) => noise({ at: 0.15 + i * 0.28, dur: 0.12, gain: 0.06, freq: 2400, to: 5000 })),
  timeup: () => {
    tone({ freq: 392, type: 'square', dur: 0.2, gain: 0.08 })
    tone({ freq: 311, type: 'square', at: 0.22, dur: 0.4, gain: 0.08 })
  },
  whoosh: () => noise({ dur: 0.45, gain: 0.1, freq: 400, to: 3200, q: 0.6 }),
  freeze: () => [2093, 2637, 3136, 2637].forEach((f, i) => tone({ freq: f, at: i * 0.05, dur: 0.25, gain: 0.05 })),
  sting: () => {
    ;[262, 330, 392].forEach((f) => tone({ freq: f, type: 'sawtooth', dur: 0.25, gain: 0.05 }))
    ;[349, 440, 523].forEach((f) => tone({ freq: f, type: 'sawtooth', at: 0.22, dur: 0.25, gain: 0.05 }))
    ;[392, 494, 587, 784].forEach((f) => tone({ freq: f, type: 'sawtooth', at: 0.44, dur: 0.9, gain: 0.06 }))
  },
  fanfare: () => {
    const seq: [number, number, number][] = [
      [523, 0, 0.18],
      [659, 0.16, 0.18],
      [784, 0.32, 0.18],
      [1047, 0.5, 0.9],
    ]
    seq.forEach(([f, at, dur]) => {
      tone({ freq: f, type: 'sawtooth', at, dur, gain: 0.07 })
      tone({ freq: f / 2, type: 'triangle', at, dur, gain: 0.07 })
    })
    ;[523, 659, 784].forEach((f) => tone({ freq: f, type: 'sawtooth', at: 0.5, dur: 1.2, gain: 0.04 }))
  },
  applause: () => {
    for (let i = 0; i < 90; i++) noise({ at: Math.random() * 1.8, dur: 0.03, gain: 0.05 + Math.random() * 0.05, freq: 1500 + Math.random() * 2500, q: 2 })
  },
  ooh: () => {
    // A small "crowd" of detuned voices sliding down through an "oo" formant.
    const c = audio()
    if (!c || !master) return
    for (let v = 0; v < 6; v++) {
      const t = c.currentTime + v * 0.02
      const osc = c.createOscillator()
      osc.type = 'sawtooth'
      const base = 190 + v * 23
      osc.frequency.setValueAtTime(base * 1.15, t)
      osc.frequency.exponentialRampToValueAtTime(base * 0.8, t + 1.1)
      const f = c.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = 450
      f.Q.value = 3
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.25)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2)
      osc.connect(f).connect(g).connect(master)
      osc.start(t)
      osc.stop(t + 1.3)
    }
  },
}

export type SfxName = keyof typeof sfx

/* -------- music: a quiet tension bed while the clock runs -------- */

let musicTimer: number | null = null
export const music = {
  start() {
    if (musicTimer !== null) return
    let beat = 0
    musicTimer = window.setInterval(() => {
      const accent = beat % 4 === 0
      tone({ freq: accent ? 70 : 60, slideTo: 38, type: 'sine', dur: 0.2, gain: accent ? 0.22 : 0.14 })
      if (beat % 2 === 1) noise({ dur: 0.04, gain: 0.025, freq: 8000, q: 1 })
      beat += 1
    }, 300)
  },
  stop() {
    if (musicTimer !== null) window.clearInterval(musicTimer)
    musicTimer = null
  },
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockAudio() {
  audio()
}
