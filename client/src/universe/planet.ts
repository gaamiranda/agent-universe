import type { AgentSession, Structure } from '@shared/types'
import { generateSurface, renderSphere, type Surface } from './surface'
import { drawSprite, STRUCTURES, SHIPS, spriteSize, type ColorMap } from './sprites'
import { rgb, mix, scale as scaleRgb, type RGB } from './palette'
import { mulberry32, TAU, lerp, clamp01, easeOutBack, easeOutCubic } from './prng'
import { toScreen, type View, type Particles, smoke, sparkle, puff } from './effects'

export type Ring = 'active' | 'completed'

interface Creature {
  lat: number
  lon: number
  speed: number
  hop: number
}
interface Satellite {
  phase: number
  speed: number
  tilt: number
  dist: number
  blink: number
}

export class Planet {
  id: string
  session: AgentSession
  surface: Surface
  rng: () => number
  baseRadius: number
  x = 0
  y = 0
  ring: Ring = 'active'
  orbitAngle: number
  orbitRadius = 0
  targetRadius = 0
  orbitSpeed: number
  /** 0..1 materialize progress */
  spawn = 0
  /** when false the planet hasn't arrived yet (ship in flight) */
  visible = false
  vScale = 1
  targetScale = 1
  rot: number
  cloudRot = 0
  rotSpeed: number
  activityVisual = 0
  energyVisual = 0
  lightsBoost = 0
  paused = 0
  creatures: Creature[] = []
  satellites: Satellite[] = []
  scouts = 0
  roverLon = 0
  private sphereCanvas: HTMLCanvasElement
  private sphereCtx: CanvasRenderingContext2D
  private img: ImageData | null = null
  private lastD = 0
  private frame = 0
  private structureBirth = new Map<string, number>()
  private smokeTimer = 0
  private sparkTimer = 0
  private lastVeg = 0
  hover = false
  /** world position of the star, for lighting */
  starX = 0
  starY = 0
  wobble = 0
  wobblePhase = 0

  constructor(session: AgentSession, angle: number) {
    this.id = session.id
    this.session = session
    this.rng = mulberry32(session.seed)
    this.surface = generateSurface(session.seed, session.planet.vegetation)
    this.lastVeg = session.planet.vegetation
    const p = session.personality
    const sizeBase = 12 + this.rng() * 6
    this.baseRadius = p === 'tiny' ? sizeBase * 0.68 : p === 'overconfident' ? sizeBase * 1.15 : sizeBase
    this.orbitAngle = angle
    this.rot = this.rng() * TAU
    this.rotSpeed = (0.12 + this.rng() * 0.1) * (p === 'sleepy' ? 0.5 : p === 'chaotic' ? 1.5 : 1) * (this.rng() < 0.2 ? -1 : 1)
    this.orbitSpeed = 0.025 + this.rng() * 0.015
    this.sphereCanvas = document.createElement('canvas')
    this.sphereCtx = this.sphereCanvas.getContext('2d', { willReadFrequently: false })!
    for (const s of session.planet.structures) this.structureBirth.set(s.id, -10)
    this.syncPopulation()
    this.syncSatellites()
    this.energyVisual = session.planet.energy
  }

  get status() {
    return this.session.status
  }
  get radius() {
    return this.baseRadius * this.vScale * (0.5 + 0.5 * this.spawn)
  }
  anchor = () => ({ x: this.x, y: this.y, r: this.radius })

  setSession(s: AgentSession, now: number) {
    const prev = this.session
    this.session = s
    for (const st of s.planet.structures) if (!this.structureBirth.has(st.id)) this.structureBirth.set(st.id, now)
    if (Math.abs(s.planet.vegetation - this.lastVeg) > 0.08) {
      this.surface = generateSurface(s.seed, s.planet.vegetation)
      this.lastVeg = s.planet.vegetation
    }
    if (s.planet.population !== prev.planet.population) this.syncPopulation()
    if (Math.round(s.planet.satellites) !== this.satellites.length) this.syncSatellites()
  }

  private syncPopulation() {
    const want = Math.min(14, Math.floor(this.session.planet.population / 3))
    while (this.creatures.length < want) this.creatures.push({ lat: (this.rng() * 2 - 1) * 0.9, lon: this.rng() * TAU, speed: (0.1 + this.rng() * 0.2) * (this.rng() < 0.5 ? 1 : -1), hop: this.rng() * TAU })
    this.creatures.length = want
  }
  private syncSatellites() {
    const want = Math.min(6, Math.round(this.session.planet.satellites))
    while (this.satellites.length < want) {
      const i = this.satellites.length
      this.satellites.push({ phase: this.rng() * TAU, speed: (0.6 + this.rng() * 0.5) * (i % 2 ? -1 : 1), tilt: 0.25 + this.rng() * 0.3, dist: 1.35 + i * 0.16 + this.rng() * 0.1, blink: this.rng() * TAU })
    }
    this.satellites.length = want
  }

  update(dt: number, now: number, intensity: number) {
    const p = this.session.planet
    const sleepy = this.session.personality === 'sleepy'
    const speedK = intensity * (this.paused > 0 ? 0.05 : 1)
    if (this.paused > 0) this.paused -= dt
    // decay short-lived bustle; server value is a ceiling we approach when events arrive
    this.activityVisual = lerp(this.activityVisual, p.activity, 1 - Math.exp(-dt * 2.5))
    const active = this.status === 'exploring' || this.status === 'building' || this.status === 'thinking' || this.status === 'trouble'
    if (!active) this.activityVisual *= Math.exp(-dt * 0.25)
    const energyTarget = this.status === 'offline' ? p.energy * 0.3 : Math.max(p.energy, this.lightsBoost)
    this.energyVisual = lerp(this.energyVisual, energyTarget, 1 - Math.exp(-dt * 1.5))
    this.lightsBoost *= Math.exp(-dt * 0.08)
    const bustle = 1 + this.activityVisual * (sleepy ? 0.6 : 1.4)
    this.rot += this.rotSpeed * dt * speedK * (0.6 + 0.4 * bustle)
    this.cloudRot += this.rotSpeed * 0.35 * dt * speedK + 0.02 * dt
    this.spawn = Math.min(1, this.spawn + (this.visible ? dt / 2.2 : 0))
    this.vScale = lerp(this.vScale, this.targetScale, 1 - Math.exp(-dt * 1.6))
    this.orbitRadius = lerp(this.orbitRadius, this.targetRadius, 1 - Math.exp(-dt * 0.9))
    for (const c of this.creatures) {
      c.lon += c.speed * dt * speedK * bustle
      c.hop += dt * 6 * bustle
    }
    for (const s of this.satellites) {
      s.phase += s.speed * dt * speedK * (0.7 + 0.6 * this.activityVisual)
      s.blink += dt * 4
    }
    this.roverLon += dt * 0.5 * speedK
    this.wobblePhase += dt * 3
    this.wobble *= Math.exp(-dt * 2)
    this.frame++
  }

  /** the lit direction: from planet toward star, in view space */
  private light(): [number, number, number] {
    const dx = this.starX - this.x
    const dy = -(this.starY - this.y)
    const len = Math.hypot(dx, dy) || 1
    const sleepy = this.session.personality === 'sleepy' || this.session.personality === 'mysterious'
    const z = sleepy ? 0.28 : 0.55
    const k = Math.sqrt(1 - z * z)
    return [(dx / len) * k, (dy / len) * k, z]
  }

  /** projects a lat/lon point; returns null if on the far side */
  project(lat: number, lon: number, R: number): { sx: number; sy: number; z: number; nx: number; ny: number; lit: number } | null {
    const l = lon + this.rot
    const cl = Math.cos(lat)
    const nx = cl * Math.sin(l)
    const ny = Math.sin(lat)
    const nz = cl * Math.cos(l)
    if (nz < 0.08) return null
    const light = this.light()
    const lit = nx * light[0] + ny * light[1] + nz * light[2]
    return { sx: nx * R, sy: -ny * R, z: nz, nx, ny, lit }
  }

  private structureColors(dark: boolean, damaged: boolean, night: boolean): ColorMap {
    const pal = this.surface.palette
    const wall: RGB = mix(pal.land, [225, 225, 235], 0.55)
    const roof: RGB = mix(pal.atmosphere, [255, 200, 120], 0.4)
    const lightC: RGB = pal.light
    const k = dark ? 0.55 : 1
    const windows = night ? (this.energyVisual > 0.12 ? rgb(lightC) : rgb(scaleRgb(wall, 0.35))) : rgb(mix(wall, [255, 255, 255], 0.5))
    return {
      w: rgb(scaleRgb(wall, damaged ? 0.4 : k)),
      r: rgb(scaleRgb(roof, damaged ? 0.4 : k)),
      l: damaged ? rgb([60, 55, 60]) : windows,
      d: rgb([40, 40, 50]),
      m: rgb(scaleRgb([190, 196, 210], damaged ? 0.45 : k)),
      g: rgb(scaleRgb(pal.veg, damaged ? 0.5 : k)),
      t: rgb(scaleRgb([120, 80, 50], k)),
      x: damaged ? rgb([120, 60, 60]) : rgb(mix(lightC, [255, 120, 120], 0.3)),
      c: rgb(mix(pal.atmosphere, [255, 255, 255], night ? 0.2 : 0.6)),
      f: '#ffb347',
      o: '#000',
    }
  }

  containsPoint(wx: number, wy: number) {
    return Math.hypot(wx - this.x, wy - this.y) <= this.radius * 1.35 + 4
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx: CanvasRenderingContext2D, v: View, layer: 'back' | 'main' | 'front', now: number, particles: Particles, intensity: number) {
    if (!this.visible) return
    const R = this.radius * v.zoom
    if (R < 1.5) return
    const [cx, cy] = toScreen(v, this.x + Math.sin(this.wobblePhase) * this.wobble, this.y)
    const D = Math.max(3, Math.round(R * 2))
    if (layer === 'back') {
      this.drawRingsAndMoons(ctx, cx, cy, R, v, true, now)
      return
    }
    if (layer === 'front') {
      this.drawRingsAndMoons(ctx, cx, cy, R, v, false, now)
      this.drawScouts(ctx, cx, cy, R, v, now)
      this.drawStatusMarkers(ctx, cx, cy, R, v, now)
      return
    }
    // atmosphere halo
    const pal = this.surface.palette
    const offline = this.status === 'offline'
    const glow = 0.18 + this.energyVisual * 0.22 + this.activityVisual * 0.15
    ctx.fillStyle = rgb(pal.atmosphere, offline ? 0.08 : glow * 0.5)
    ctx.beginPath()
    ctx.arc(cx, cy, R + Math.max(1.5, 2.5 * v.zoom), 0, TAU)
    ctx.fill()
    ctx.fillStyle = rgb(pal.atmosphere, offline ? 0.15 : glow)
    ctx.beginPath()
    ctx.arc(cx, cy, R + Math.max(1, 1.2 * v.zoom), 0, TAU)
    ctx.fill()
    // sphere (cached, updated every few frames)
    const refreshEvery = R > 40 ? 3 : 2
    if (D !== this.lastD || !this.img || this.frame % refreshEvery === 0) {
      if (D !== this.lastD || !this.img) {
        this.img = this.sphereCtx.createImageData(D, D)
        this.sphereCanvas.width = D
        this.sphereCanvas.height = D
        this.lastD = D
      }
      renderSphere(this.img, this.surface, D, this.rot, this.cloudRot, this.light(), offline ? 0 : this.energyVisual, this.session.planet.damage, now / 1000)
      this.sphereCtx.putImageData(this.img, 0, 0)
    }
    // materialize: dithered reveal from the center
    if (this.spawn < 1) {
      const k = easeOutCubic(this.spawn)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R * k + 1, 0, TAU)
      ctx.clip()
      ctx.globalAlpha = 0.5 + k * 0.5
      ctx.drawImage(this.sphereCanvas, Math.round(cx - D / 2), Math.round(cy - D / 2))
      ctx.restore()
      ctx.globalAlpha = 1
      if (Math.random() < 0.5) puff(particles, this.x + (Math.random() - 0.5) * this.radius * 2, this.y + (Math.random() - 0.5) * this.radius * 2, rgb(pal.atmosphere), 1, 6)
      return
    }
    ctx.drawImage(this.sphereCanvas, Math.round(cx - D / 2), Math.round(cy - D / 2))
    if (offline) {
      ctx.fillStyle = 'rgba(10,12,24,0.55)'
      ctx.beginPath()
      ctx.arc(cx, cy, R + 0.5, 0, TAU)
      ctx.fill()
    }
    this.drawSurfaceLife(ctx, cx, cy, R, v, now, particles, intensity)
  }

  private drawSurfaceLife(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, v: View, now: number, particles: Particles, intensity: number) {
    const p = this.session.planet
    const unit = Math.max(1, Math.round(v.zoom * this.vScale * 1.25))
    const tiny = R < 9
    const offline = this.status === 'offline'
    // structures, sorted so nearer ones draw last
    const structs = p.structures
      .map((s) => ({ s, pr: this.project(s.lat, s.lon, R) }))
      .filter((x) => x.pr)
      .sort((a, b) => a.pr!.z - b.pr!.z)
    this.smokeTimer -= 1 / 60
    this.sparkTimer -= 1 / 60
    for (const { s, pr } of structs) {
      const P = pr!
      const night = P.lit < 0.05
      const damaged = s.damaged > 0
      const age = (now - (this.structureBirth.get(s.id) ?? now)) / 1000
      const sprite = STRUCTURES[s.kind]
      const size = spriteSize(sprite)
      if (tiny || P.z < 0.42) {
        // far from the center of the disc: just a dot
        ctx.fillStyle = damaged ? '#3a3038' : night && this.energyVisual > 0.12 && !offline ? rgb(this.surface.palette.light) : rgb(mix(this.surface.palette.land, [255, 255, 255], 0.6))
        ctx.fillRect(Math.round(cx + P.sx), Math.round(cy + P.sy), unit, unit)
        continue
      }
      // "stand up" from the surface: offset outward along the 2D normal a little
      const depthScale = 0.6 + 0.4 * P.z
      const u = Math.max(1, Math.round(unit * depthScale))
      const w = size.w * u
      const h = size.h * u
      const ox = cx + P.sx + P.nx * u * 0.5 - w / 2
      const oy = cy + P.sy - P.ny * u * 0.5 - h + u * 0.5
      const colors = this.structureColors(P.z < 0.6, damaged, night && !offline)
      // construction pop-in: rows appear bottom-up, with sparks
      const rows = age < 1.2 ? Math.max(1, Math.ceil(size.h * easeOutCubic(clamp01(age / 1.2)))) : size.h
      const partial = rows < size.h || damaged ? sprite.slice(size.h - rows) : sprite
      const dy = (size.h - partial.length) * u
      const shown = damaged ? partial.map((row, i) => (i === 0 ? row.replace(/[^.]/g, '.') : row)) : partial
      if (night && !offline && !damaged && this.energyVisual > 0.12) {
        ctx.fillStyle = rgb(this.surface.palette.light, 0.35)
        ctx.fillRect(Math.round(ox - u), Math.round(oy + dy - u), w + u * 2, h + u * 2)
      }
      drawSprite(ctx, shown, ox, oy + dy, u, colors)
      if (age < 1.4 && intensity > 0.2 && Math.random() < 0.35) sparkle(particles, this.x + P.sx / v.zoom, this.y + P.sy / v.zoom - 2, '#ffe9a0', 1)
      if (damaged && this.smokeTimer <= 0 && intensity > 0.1) {
        smoke(particles, this.x + P.sx / v.zoom, this.y + P.sy / v.zoom - h / v.zoom)
      }
      if (s.kind === 'factory' && !damaged && this.activityVisual > 0.25 && Math.random() < 0.08 * intensity) {
        particles.spawn({ x: this.x + P.sx / v.zoom + (P.nx > 0 ? 1.5 : -1.5), y: this.y + P.sy / v.zoom - h / v.zoom, vx: 0, vy: -5, max: 0.8, color: '#d8d8e0', size: 1, drag: 1 })
      }
      if (s.kind === 'beacon' || s.kind === 'antenna') {
        if (Math.floor(now / 500 + s.lat * 10) % 3 === 0 && !damaged) {
          ctx.fillStyle = s.kind === 'beacon' ? '#ff6b6b' : '#7fd7ff'
          ctx.fillRect(Math.round(ox + (s.kind === 'beacon' ? u : 0)), Math.round(oy + dy), u, u)
        }
      }
    }
    if (this.smokeTimer <= 0) this.smokeTimer = 0.35
    if (tiny || offline) return
    // creatures: tiny hopping dots on the day side
    const cUnit = Math.max(1, Math.round(unit * 0.8))
    for (const c of this.creatures) {
      const P = this.project(c.lat, c.lon, R)
      if (!P || P.z < 0.35 || P.lit < 0.1) continue
      const hop = Math.abs(Math.sin(c.hop)) > 0.7 ? 1 : 0
      ctx.fillStyle = rgb(mix(this.surface.palette.light, [255, 255, 255], 0.4))
      ctx.fillRect(Math.round(cx + P.sx), Math.round(cy + P.sy - hop * unit - cUnit), cUnit, cUnit)
    }
    // rover exploring while the agent is reading around
    if (this.status === 'exploring' || this.status === 'thinking') {
      const P = this.project(0.15, this.roverLon, R)
      if (P && P.z > 0.3) {
        ctx.fillStyle = '#e6e6f0'
        ctx.fillRect(Math.round(cx + P.sx), Math.round(cy + P.sy - unit), unit * 2, unit)
        ctx.fillStyle = Math.floor(now / 250) % 2 ? '#7fd7ff' : '#ffffff'
        ctx.fillRect(Math.round(cx + P.sx + unit * 2), Math.round(cy + P.sy - unit), unit, unit)
      }
    }
  }

  private drawRingsAndMoons(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, v: View, back: boolean, now: number) {
    const pal = this.surface.palette
    const unit = Math.max(1, Math.round(v.zoom * this.vScale))
    if (this.surface.rings && this.spawn > 0.5) {
      const rx = R * 1.75
      const ry = rx * this.surface.ringTilt
      const n = Math.max(24, Math.round(rx * 1.4))
      ctx.fillStyle = rgb(this.surface.ringColor, 0.85)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU
        const sy = Math.sin(a)
        if (back ? sy > 0 : sy <= 0) continue
        const px = cx + Math.cos(a) * rx
        const py = cy + sy * ry
        if (!back && Math.hypot(px - cx, py - cy) < R) continue
        ctx.fillRect(Math.round(px), Math.round(py), unit, unit)
        if (i % 3 === 0) {
          ctx.globalAlpha = 0.5
          ctx.fillRect(Math.round(cx + Math.cos(a) * rx * 1.12), Math.round(cy + sy * ry * 1.12), unit, unit)
          ctx.globalAlpha = 1
        }
      }
    }
    for (const m of this.surface.moons) {
      const a = m.phase + (now / 1000) * m.speed
      const sy = Math.sin(a)
      if (back ? sy > 0 : sy <= 0) continue
      const mx = cx + Math.cos(a) * R * m.dist
      const my = cy + sy * R * m.dist * 0.4 - R * 0.2
      const mr = Math.max(1, R * m.size)
      ctx.fillStyle = rgb(scaleRgb(m.color, 0.55))
      ctx.beginPath()
      ctx.arc(Math.round(mx), Math.round(my), mr, 0, TAU)
      ctx.fill()
      ctx.fillStyle = rgb(m.color)
      ctx.beginPath()
      ctx.arc(Math.round(mx) - mr * 0.25, Math.round(my) - mr * 0.25, mr * 0.7, 0, TAU)
      ctx.fill()
    }
    for (const s of this.satellites) {
      const sy = Math.sin(s.phase)
      if (back ? sy > 0 : sy <= 0) continue
      const sx = cx + Math.cos(s.phase) * R * s.dist
      const py = cy + sy * R * s.dist * s.tilt
      ctx.fillStyle = '#cfd3e0'
      ctx.fillRect(Math.round(sx), Math.round(py), unit, unit)
      if (Math.sin(s.blink) > 0.6) {
        ctx.fillStyle = '#7fd7ff'
        ctx.fillRect(Math.round(sx + unit), Math.round(py), unit, unit)
      }
    }
    if (!back) {
      ctx.strokeStyle = rgb(pal.atmosphere, 0.12)
      ctx.lineWidth = 1
      for (const s of this.satellites.slice(0, 1)) {
        ctx.beginPath()
        ctx.ellipse(cx, cy, R * s.dist, R * s.dist * s.tilt, 0, 0, TAU)
        ctx.stroke()
      }
    }
  }

  private drawScouts(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, v: View, now: number) {
    if (this.scouts <= 0) return
    const px = Math.max(1, Math.round(v.zoom * this.vScale * 0.9))
    for (let i = 0; i < Math.min(4, this.scouts); i++) {
      const a = (now / 1000) * 1.4 + (i * TAU) / 4
      const sx = cx + Math.cos(a) * R * 2.1
      const sy = cy + Math.sin(a) * R * 0.8 - R * 0.9
      drawSprite(ctx, SHIPS.scout, sx - px * 1.5, sy - px, px, { m: '#e6e6f0', l: '#ffd86b', f: Math.random() < 0.5 ? '#ffb347' : '#fff1c9' })
    }
  }

  private drawStatusMarkers(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, v: View, now: number) {
    const unit = Math.max(1, Math.round(v.zoom))
    if (this.status === 'waiting') {
      // blinking beacon above the planet: the human is needed
      if (Math.floor(now / 450) % 2 === 0) {
        const bx = Math.round(cx - unit / 2)
        const by = Math.round(cy - R - 8 * unit)
        ctx.fillStyle = '#ffd86b'
        ctx.fillRect(bx, by, unit, unit * 3)
        ctx.fillRect(bx, by + unit * 4, unit, unit)
      }
    } else if (this.status === 'offline') {
      if (Math.floor(now / 900) % 2 === 0) {
        ctx.fillStyle = '#ff6b6b'
        ctx.fillRect(Math.round(cx + R * 0.7), Math.round(cy - R * 0.7), unit, unit)
      }
    } else if (this.status === 'thinking' && Math.floor(now / 600) % 3 !== 2) {
      // little thought-dots drifting up
      const k = Math.floor(now / 600) % 3
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillRect(Math.round(cx + R * 0.75 + k * unit), Math.round(cy - R * 0.9 - k * unit * 1.5), unit, unit)
    }
    if (this.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, R + 4 * unit + Math.sin(now / 200), 0, TAU)
      ctx.stroke()
    }
  }

  /** brief pause + wobble used when a celebration or hit begins */
  nudge(amount = 1.5) {
    this.wobble = amount
  }

  /** returns world coordinates of a random surface point on the visible side */
  randomSurfacePoint(): { x: number; y: number } {
    const a = this.rng() * TAU
    const r = this.rng() * this.radius * 0.8
    return { x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r }
  }

  structureWorldPos(s: Structure): { x: number; y: number } | null {
    const P = this.project(s.lat, s.lon, this.radius)
    if (!P) return null
    return { x: this.x + P.sx, y: this.y + P.sy }
  }
}
