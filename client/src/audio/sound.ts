/**
 * Tiny synthesized sound design. No audio files — everything is Web Audio.
 * Every category has a cooldown so a busy universe never becomes noisy.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let volume = 0.5
const lastPlayed = new Map<string, number>()

function ensure(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = volume * 0.6
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export function setSoundEnabled(v: boolean) {
  enabled = v
}
export function setVolume(v: number) {
  volume = v
  if (master) master.gain.value = v * 0.6
}
/** call from a user gesture to unlock audio */
export function unlockAudio() {
  ensure()
}

function can(key: string, cooldownMs: number): boolean {
  if (!enabled) return false
  const now = performance.now()
  const last = lastPlayed.get(key) ?? -Infinity
  if (now - last < cooldownMs) return false
  lastPlayed.set(key, now)
  return true
}

type Wave = OscillatorType
function tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; attack?: number; decay?: number; slide?: number; delay?: number } = {}) {
  const c = ensure()
  if (!c || !master) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = opts.type ?? 'square'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t0 + dur)
  const gain = opts.gain ?? 0.15
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + (opts.attack ?? 0.005))
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur)
  osc.connect(g).connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(dur: number, gain = 0.08, delay = 0, hp = 800) {
  const c = ensure()
  if (!c || !master) return
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = hp
  const g = c.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(master)
  src.start(c.currentTime + delay)
}

const vary = (f: number, cents = 40) => f * Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200)

export const sfx = {
  spawn() {
    if (!can('spawn', 1500)) return
    ;[523, 659, 784, 1047].forEach((f, i) => tone(vary(f, 10), 0.5, { type: 'sine', gain: 0.12, delay: i * 0.09, attack: 0.02 }))
    noise(0.6, 0.02, 0, 3000)
  },
  blip() {
    if (!can('blip', 900)) return
    tone(vary(1200, 200), 0.05, { type: 'square', gain: 0.035 })
  },
  tick() {
    if (!can('tick', 1400)) return
    tone(vary(300, 100), 0.06, { type: 'triangle', gain: 0.05, slide: 0.6 })
    tone(vary(420, 100), 0.05, { type: 'triangle', gain: 0.03, delay: 0.07 })
  },
  build() {
    if (!can('build', 1800)) return
    tone(vary(220), 0.08, { type: 'square', gain: 0.04 })
    tone(vary(330), 0.08, { type: 'square', gain: 0.04, delay: 0.1 })
    noise(0.08, 0.03, 0.05, 2000)
  },
  good() {
    if (!can('good', 2500)) return
    tone(vary(660, 15), 0.12, { type: 'triangle', gain: 0.08 })
    tone(vary(880, 15), 0.25, { type: 'triangle', gain: 0.08, delay: 0.1 })
  },
  error() {
    if (!can('error', 3000)) return
    tone(vary(300, 30), 0.35, { type: 'sawtooth', gain: 0.07, slide: 0.55 })
    tone(vary(150, 30), 0.3, { type: 'square', gain: 0.04, delay: 0.12, slide: 0.7 })
    noise(0.25, 0.04, 0.05, 400)
  },
  repair() {
    if (!can('repair', 3000)) return
    ;[392, 494, 587].forEach((f, i) => tone(vary(f, 10), 0.18, { type: 'triangle', gain: 0.07, delay: i * 0.08 }))
  },
  commit() {
    if (!can('commit', 4000)) return
    tone(200, 0.6, { type: 'sawtooth', gain: 0.05, slide: 3 })
    noise(0.7, 0.05, 0, 600)
    ;[784, 988].forEach((f, i) => tone(f, 0.3, { type: 'sine', gain: 0.08, delay: 0.5 + i * 0.12 }))
  },
  waiting() {
    if (!can('waiting', 8000)) return
    tone(880, 0.12, { type: 'sine', gain: 0.08 })
    tone(880, 0.12, { type: 'sine', gain: 0.08, delay: 0.2 })
  },
  complete() {
    if (!can('complete', 6000)) return
    const seq = [523, 659, 784, 1047, 784, 1047, 1319]
    seq.forEach((f, i) => tone(f, 0.35, { type: i > 3 ? 'triangle' : 'square', gain: 0.09, delay: i * 0.11, attack: 0.01 }))
    tone(261, 1.4, { type: 'sine', gain: 0.06, delay: 0.5 })
    tone(329, 1.4, { type: 'sine', gain: 0.05, delay: 0.5 })
    noise(1.2, 0.03, 0.8, 4000)
  },
  mission() {
    if (!can('mission', 20000)) return
    const chords = [
      [261, 329, 392],
      [349, 440, 523],
      [392, 494, 587],
      [523, 659, 784, 1047],
    ]
    chords.forEach((ch, i) => ch.forEach((f) => tone(f, i === 3 ? 2.2 : 0.55, { type: 'triangle', gain: 0.06, delay: i * 0.5, attack: 0.05 })))
    ;[1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.5, { type: 'sine', gain: 0.06, delay: 2.1 + i * 0.12 }))
    noise(1.5, 0.03, 2.3, 3000)
  },
  offline() {
    if (!can('offline', 10000)) return
    tone(440, 0.4, { type: 'sine', gain: 0.05, slide: 0.5 })
  },
}
