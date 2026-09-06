import type { Personality } from './shared/types.js'

/** Tiny seeded PRNG (mulberry32). Same seed → same planet, forever. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const FIRST = [
  'Amber', 'Velvet', 'Quiet', 'Copper', 'Lumen', 'Moss', 'Saffron', 'Cobalt', 'Pale', 'Wobbly',
  'Umber', 'Frost', 'Ochre', 'Dusk', 'Tidal', 'Hollow', 'Glass', 'Rusty', 'Little', 'Verdant',
  'Sleepy', 'Brisk', 'Marble', 'Pepper', 'Honey', 'Cinder', 'Nimbus', 'Plum', 'Salt', 'Fable',
]
const SECOND = [
  'Loom', 'Harbor', 'Vale', 'Orchard', 'Kettle', 'Meridian', 'Lantern', 'Beacon', 'Burrow', 'Spindle',
  'Atlas', 'Grove', 'Ember', 'Quill', 'Tundra', 'Cairn', 'Hearth', 'Reef', 'Drift', 'Anvil',
  'Prism', 'Fjord', 'Bramble', 'Sprocket', 'Tangle', 'Comet', 'Halo', 'Mire', 'Pebble', 'Wick',
]

export function planetName(seed: number): string {
  const r = mulberry32(seed ^ 0x9e3779b9)
  const a = FIRST[Math.floor(r() * FIRST.length)]
  const b = SECOND[Math.floor(r() * SECOND.length)]
  const num = Math.floor(r() * 90) + 10
  return r() < 0.35 ? `${a} ${b}-${num}` : `${a} ${b}`
}

const PERSONALITIES: Personality[] = ['chaotic', 'industrious', 'sleepy', 'exploratory', 'overconfident', 'mysterious', 'tiny']

export function pickPersonality(seed: number): Personality {
  const r = mulberry32(seed ^ 0x51ed270b)
  return PERSONALITIES[Math.floor(r() * PERSONALITIES.length)]
}
