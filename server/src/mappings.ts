/**
 * Event → planet reaction mappings.
 *
 * This is the "tuning table" of the universe. Each entry says how a normalized
 * event nudges the persistent PlanetState. Transient visual effects (lightning,
 * fireworks, scanner pulses) are handled on the client from the same event
 * types — see client/src/universe/reactions.ts.
 *
 * Add new event types here without touching the renderer.
 */
import type { PlanetState, Structure, StructureKind, UniverseEventType, Personality } from './shared/types.js'
import { mulberry32 } from './names.js'

export interface Reaction {
  energy?: number
  activity?: number
  vegetation?: number
  population?: number
  satellites?: number
  discoveries?: number
  damage?: number
  /** repair fraction applied to damaged structures */
  repair?: number
  /** structures to try to add (probabilistic) */
  build?: { kinds: StructureKind[]; chance: number; max?: number }
  /** break one existing structure */
  breakStructure?: boolean
  celebrate?: boolean
}

export const REACTIONS: Partial<Record<UniverseEventType, Reaction>> = {
  session_started: { energy: 0.05, activity: 0.3 },
  prompt: { activity: 0.4, energy: 0.02 },
  thinking: { activity: 0.1 },
  tool_started: { activity: 0.15, energy: 0.01 },
  tool_completed: { activity: 0.05 },
  file_read: { activity: 0.18, discoveries: 0.15, satellites: 0.25, build: { kinds: ['antenna', 'hut'], chance: 0.2, max: 5 } },
  search: { activity: 0.18, discoveries: 0.2, satellites: 0.3, build: { kinds: ['antenna', 'dome'], chance: 0.1, max: 4 } },
  web: { activity: 0.2, discoveries: 0.3, satellites: 0.5 },
  file_created: { activity: 0.45, energy: 0.06, population: 3, build: { kinds: ['hut', 'tower', 'dome', 'lab', 'hut'], chance: 1 } },
  file_modified: { activity: 0.35, energy: 0.04, population: 1, vegetation: 0.03, build: { kinds: ['hut', 'tree', 'tower', 'tree', 'hut'], chance: 0.65 } },
  command_started: { activity: 0.3, energy: 0.02, build: { kinds: ['factory'], chance: 0.35, max: 4 } },
  command_completed: { activity: 0.1, energy: 0.04, population: 1, repair: 0.2 },
  command_failed: { activity: 0.3, damage: 0.22, breakStructure: true },
  test_started: { activity: 0.4, build: { kinds: ['lab'], chance: 0.6, max: 3 } },
  test_passed: { activity: 0.3, energy: 0.14, vegetation: 0.08, population: 4, repair: 0.6 },
  test_failed: { activity: 0.35, damage: 0.3, breakStructure: true },
  install: { activity: 0.4, energy: 0.05, vegetation: 0.05, build: { kinds: ['factory', 'tower'], chance: 0.8 } },
  commit: { activity: 0.6, energy: 0.15, discoveries: 1, population: 5, repair: 0.4, build: { kinds: ['monument', 'beacon'], chance: 1 } },
  subagent_started: { activity: 0.3, satellites: 1 },
  subagent_completed: { activity: 0.2, energy: 0.05, discoveries: 0.5 },
  error: { activity: 0.25, damage: 0.18, breakStructure: true },
  waiting: { activity: -0.1 },
  turn_completed: { energy: 0.35, activity: 0.6, vegetation: 0.1, population: 6, repair: 1, celebrate: true, build: { kinds: ['monument', 'crystal'], chance: 0.7 } },
  session_ended: {},
  offline: { activity: -0.5 },
}

/** personality nudges: how strongly a world responds */
export const PERSONALITY_BIAS: Record<Personality, Partial<Record<keyof Reaction, number>>> = {
  chaotic: { damage: 1.3, activity: 1.3, build: 1.1 },
  industrious: { build: 1.4, energy: 1.2, population: 1.3 },
  sleepy: { activity: 0.7, build: 0.8, vegetation: 1.4 },
  exploratory: { satellites: 1.6, discoveries: 1.5 },
  overconfident: { energy: 1.3, damage: 1.1, build: 1.2 },
  mysterious: { build: 0.9, discoveries: 1.2, satellites: 1.2 },
  tiny: { build: 0.7, population: 0.6, vegetation: 1.2 },
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export interface ApplyResult {
  state: PlanetState
  built: Structure[]
  broken: Structure | null
  repaired: boolean
}

export function applyReaction(
  state: PlanetState,
  type: UniverseEventType,
  personality: Personality,
  density: number,
  now: number,
  seed: number,
): ApplyResult {
  const r = REACTIONS[type]
  const built: Structure[] = []
  let broken: Structure | null = null
  let repaired = false
  if (!r) return { state, built, broken, repaired }
  const bias = PERSONALITY_BIAS[personality] ?? {}
  const b = (k: keyof Reaction) => bias[k] ?? 1
  const rng = mulberry32((seed ^ now) >>> 0)

  const s: PlanetState = { ...state, structures: [...state.structures] }
  if (r.energy) s.energy = clamp01(s.energy + r.energy * b('energy'))
  if (r.activity) s.activity = clamp01(s.activity + r.activity * b('activity'))
  if (r.vegetation) s.vegetation = clamp01(s.vegetation + r.vegetation * b('vegetation') * density)
  if (r.population) s.population = Math.max(0, s.population + r.population * b('population') * density)
  if (r.satellites) s.satellites = Math.min(6, s.satellites + r.satellites * b('satellites') * 0.5)
  if (r.discoveries) s.discoveries += r.discoveries * b('discoveries')
  if (r.damage) s.damage = clamp01(s.damage + r.damage * b('damage'))
  if (r.repair) {
    const had = s.damage > 0.05 || s.structures.some((st) => st.damaged > 0)
    s.damage = clamp01(s.damage - r.repair * 0.6)
    s.structures = s.structures.map((st) => (st.damaged > 0 && rng() < r.repair! ? { ...st, damaged: 0 } : st))
    if (had && s.damage < 0.05) repaired = true
  }
  if (r.breakStructure) {
    const intact = s.structures.filter((st) => st.damaged === 0 && st.kind !== 'monument')
    if (intact.length) {
      const victim = intact[Math.floor(rng() * intact.length)]
      s.structures = s.structures.map((st) => (st.id === victim.id ? { ...st, damaged: 1 } : st))
      broken = { ...victim, damaged: 1 }
    }
  }
  if (r.build) {
    const cap = 36 * density
    const kindCount = (k: StructureKind) => s.structures.filter((st) => st.kind === k).length
    const kinds = r.build.kinds
    const kind = kinds[Math.floor(rng() * kinds.length)]
    const underMax = r.build.max === undefined || kindCount(kind) < r.build.max
    if (s.structures.length < cap && underMax && rng() < r.build.chance * b('build') * density) {
      const st = placeStructure(kind, s.structures, rng, now)
      if (st) {
        s.structures.push(st)
        built.push(st)
      }
    }
  }
  if (r.celebrate) s.celebrations += 1
  return { state: s, built, broken, repaired }
}

/** find a spot on the sphere that isn't too close to an existing structure */
function placeStructure(kind: StructureKind, existing: Structure[], rng: () => number, now: number): Structure | null {
  for (let tries = 0; tries < 12; tries++) {
    const lat = (rng() * 2 - 1) * 0.95 // radians, avoid the exact poles
    const lon = rng() * Math.PI * 2
    const tooClose = existing.some((e) => {
      const dlat = e.lat - lat
      let dlon = Math.abs(e.lon - lon)
      if (dlon > Math.PI) dlon = Math.PI * 2 - dlon
      return Math.hypot(dlat, dlon * Math.cos(lat)) < 0.28
    })
    if (!tooClose) {
      return { id: `${now.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`, kind, lat, lon, bornAt: now, damaged: 0 }
    }
  }
  return null
}

export function emptyPlanet(): PlanetState {
  return { energy: 0, activity: 0, vegetation: 0, population: 0, satellites: 0, discoveries: 0, damage: 0, celebrations: 0, structures: [] }
}
