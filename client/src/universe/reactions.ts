/**
 * Client-side event → transient effect mapping.
 * The persistent planet changes are computed on the server (mappings.ts);
 * this file decides what *happens on screen* when an event arrives.
 * Add entries freely — the scene passes itself so reactions can spawn anything.
 */
import type { UniverseEvent, Structure } from '@shared/types'
import type { Scene } from './scene'
import type { Planet } from './planet'
import { Ring, Lightning, Ufo, Meteor, firework, puff, sparkle } from './effects'
import { rgb } from './palette'
import { sfx } from '../audio/sound'

export type ReactionFn = (scene: Scene, planet: Planet, event: UniverseEvent) => void

const built = (scene: Scene, planet: Planet, e: UniverseEvent) => {
  const list = (e.metadata?.built as Structure[] | undefined) ?? []
  for (const s of list) {
    const p = planet.structureWorldPos(s)
    if (p) puff(scene.particles, p.x, p.y, '#ffe9a0', 6, 12)
  }
  return list.length > 0
}

const broke = (scene: Scene, planet: Planet, e: UniverseEvent) => {
  const s = e.metadata?.broken as Structure | undefined
  if (!s) return false
  const p = planet.structureWorldPos(s)
  if (p) puff(scene.particles, p.x, p.y, '#8a8a95', 10, 18)
  return true
}

const recovered = (scene: Scene, planet: Planet, e: UniverseEvent) => {
  if (!e.metadata?.recovered) return
  for (let i = 0; i < 4; i++) {
    const p = planet.randomSurfacePoint()
    sparkle(scene.particles, p.x, p.y, '#b8ffcf', 4)
  }
  scene.addEffect(new Ring(planet.anchor, 'rgba(184,255,207,0.8)', 1.1, 1.6))
  sfx.repair()
}

export const REACTIONS: Partial<Record<UniverseEvent['type'], ReactionFn>> = {
  session_started: (scene, planet) => {
    if (!planet.visible) scene.arrive(planet)
  },
  prompt: (scene, planet, e) => {
    if (e.metadata?.reawakened) scene.reawaken(planet)
    else scene.addEffect(new Ring(planet.anchor, 'rgba(255,255,255,0.5)', 0.8, 1.4))
    sfx.blip()
  },
  file_read: (scene, planet) => {
    scene.addEffect(new Ring(planet.anchor, rgb(planet.surface.palette.atmosphere, 0.9), 0.8, 1.5))
    sfx.blip()
  },
  search: (scene, planet) => {
    scene.addEffect(new Ring(planet.anchor, 'rgba(127,215,255,0.9)', 1, 1.8))
    scene.addEffect(new Ring(planet.anchor, 'rgba(127,215,255,0.5)', 1.2, 2.2))
    sfx.blip()
  },
  web: (scene, planet) => {
    scene.addEffect(new Ring(planet.anchor, 'rgba(200,180,255,0.9)', 1.2, 2.4))
    sfx.blip()
  },
  file_created: (scene, planet, e) => {
    built(scene, planet, e)
    sfx.build()
  },
  file_modified: (scene, planet, e) => {
    if (!built(scene, planet, e)) {
      const p = planet.randomSurfacePoint()
      sparkle(scene.particles, p.x, p.y, '#ffe9a0', 3)
    }
    sfx.tick()
  },
  command_started: (scene, planet, e) => {
    built(scene, planet, e)
    sfx.tick()
  },
  test_started: (scene, planet, e) => {
    built(scene, planet, e)
    scene.addEffect(new Ring(planet.anchor, 'rgba(255,255,255,0.4)', 0.6, 1.3))
  },
  install: (scene, planet, e) => {
    built(scene, planet, e)
    sfx.build()
  },
  command_completed: (scene, planet, e) => {
    recovered(scene, planet, e)
  },
  test_passed: (scene, planet, e) => {
    planet.lightsBoost = Math.max(planet.lightsBoost, 0.9)
    scene.addEffect(new Ring(planet.anchor, rgb(planet.surface.palette.light, 0.9), 1.2, 1.7, 2))
    for (let i = 0; i < 3; i++) {
      const p = planet.randomSurfacePoint()
      sparkle(scene.particles, p.x, p.y, rgb(planet.surface.palette.light), 5)
    }
    recovered(scene, planet, e)
    sfx.good()
  },
  test_failed: (scene, planet, e) => {
    scene.addEffect(new Lightning(planet.anchor, () => { planet.nudge(2); broke(scene, planet, e) }))
    scene.addEffect(new Lightning(planet.anchor))
    sfx.error()
  },
  command_failed: (scene, planet, e) => {
    const chaotic = planet.session.personality === 'chaotic'
    if (Math.random() < (chaotic ? 0.6 : 0.35)) scene.addEffect(new Meteor(planet.anchor, scene.particles, () => { planet.nudge(2); broke(scene, planet, e) }))
    else scene.addEffect(new Lightning(planet.anchor, () => { planet.nudge(1.5); broke(scene, planet, e) }))
    sfx.error()
  },
  error: (scene, planet, e) => {
    scene.addEffect(new Ufo(planet.anchor, scene.particles, true, () => { planet.nudge(1.5); broke(scene, planet, e) }))
    sfx.error()
  },
  subagent_started: (scene, planet) => {
    planet.scouts++
    const a = planet.anchor()
    puff(scene.particles, a.x, a.y - a.r, '#ffd86b', 6, 14)
    sfx.tick()
  },
  subagent_completed: (scene, planet, e) => {
    planet.scouts = Math.max(0, planet.scouts - 1)
    const a = planet.anchor()
    sparkle(scene.particles, a.x, a.y - a.r * 1.3, '#ffd86b', 5)
    recovered(scene, planet, e)
  },
  commit: (scene, planet, e) => {
    built(scene, planet, e)
    scene.milestoneRocket(planet)
    sfx.commit()
  },
  waiting: (scene, planet) => {
    scene.addEffect(new Ring(planet.anchor, 'rgba(255,216,107,0.8)', 1.4, 1.8))
    sfx.waiting()
  },
  thinking: (scene, planet) => {
    const a = planet.anchor()
    sparkle(scene.particles, a.x + a.r * 0.8, a.y - a.r, '#ffffff', 2)
  },
  turn_completed: (scene, planet) => {
    scene.celebrate(planet)
  },
  session_ended: (scene, planet) => {
    if (planet.ring === 'active') scene.retire(planet, false)
  },
  offline: (scene, planet) => {
    scene.addEffect(new Ring(planet.anchor, 'rgba(255,107,107,0.6)', 1.6, 1.5))
    sfx.offline()
  },
}

/** ambient personality mischief, called occasionally by the scene */
export function personalityTick(scene: Scene, planet: Planet) {
  const p = planet.session.personality
  if (!planet.visible || planet.status === 'offline') return
  if (p === 'chaotic' && Math.random() < 0.3) scene.addEffect(new Meteor(planet.anchor, scene.particles, () => planet.nudge(0.6)))
  else if (p === 'mysterious' && Math.random() < 0.35) scene.addEffect(new Ufo(planet.anchor, scene.particles, false))
  else if (p === 'exploratory' && Math.random() < 0.3) scene.addEffect(new Ring(planet.anchor, rgb(planet.surface.palette.atmosphere, 0.5), 1.5, 2))
  else if (p === 'overconfident' && Math.random() < 0.2) firework(scene.particles, planet.x, planet.y - planet.radius * 1.5, rgb(planet.surface.palette.light), 10, 30)
  else if (p === 'sleepy' && Math.random() < 0.4) {
    const a = planet.anchor()
    sparkle(scene.particles, a.x + a.r * 0.6, a.y - a.r * 0.9, 'rgba(200,210,255,0.8)', 2)
  }
}
