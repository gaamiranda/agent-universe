/**
 * Transient visual effects: particles, lightning, rings, beams, rockets,
 * ufos, meteors, arriving ships, fireworks. Everything lives in world space.
 */
import { drawSprite, SHIPS, spriteSize } from './sprites'
import { TAU, easeOutCubic, easeInCubic, easeInOutCubic, lerp, mulberry32, clamp01 } from './prng'

export interface View {
  x: number
  y: number
  zoom: number
  W: number
  H: number
}
export const toScreen = (v: View, wx: number, wy: number): [number, number] => [(wx - v.x) * v.zoom + v.W / 2, (wy - v.y) * v.zoom + v.H / 2]

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
  gravity: number
  drag: number
  /** fade style */
  fade: 'out' | 'flicker' | 'none'
  twinkle?: boolean
}

export class Particles {
  list: Particle[] = []
  max = 900
  spawn(p: Partial<Particle> & { x: number; y: number; color: string }) {
    if (this.list.length >= this.max) this.list.shift()
    const max = p.max ?? p.life ?? 1
    this.list.push({ vx: 0, vy: 0, size: 1, gravity: 0, drag: 0, fade: 'out', ...p, max, life: max })
  }
  update(dt: number) {
    const l = this.list
    let w = 0
    for (let i = 0; i < l.length; i++) {
      const p = l[i]
      p.life -= dt
      if (p.life <= 0) continue
      p.vy += p.gravity * dt
      if (p.drag) {
        const d = Math.max(0, 1 - p.drag * dt)
        p.vx *= d
        p.vy *= d
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      l[w++] = p
    }
    l.length = w
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    for (const p of this.list) {
      const t = p.life / p.max
      let a = p.fade === 'out' ? t : p.fade === 'flicker' ? (Math.random() < 0.7 ? t : 0) : 1
      if (p.twinkle) a *= 0.5 + 0.5 * Math.sin(p.life * 20)
      if (a <= 0.02) continue
      const [sx, sy] = toScreen(v, p.x, p.y)
      const s = Math.max(1, Math.round(p.size * v.zoom))
      ctx.globalAlpha = Math.min(1, a)
      ctx.fillStyle = p.color
      ctx.fillRect(Math.round(sx), Math.round(sy), s, s)
    }
    ctx.globalAlpha = 1
  }
}

export interface Effect {
  /** return false when finished */
  update(dt: number, now: number): boolean
  draw(ctx: CanvasRenderingContext2D, v: View): void
  layer: 'back' | 'front'
}

export type Anchor = () => { x: number; y: number; r: number }

const rng = mulberry32(12345)
const rand = (a: number, b: number) => a + rng() * (b - a)

/** expanding ring — scanner pulse, "lights on" wave */
export class Ring implements Effect {
  layer: 'front' = 'front'
  t = 0
  constructor(private anchor: Anchor, private color: string, private duration = 0.9, private spread = 1.9, private width = 1) {}
  update(dt: number) {
    this.t += dt / this.duration
    return this.t < 1
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const a = this.anchor()
    const [sx, sy] = toScreen(v, a.x, a.y)
    const r = (a.r + a.r * (this.spread - 1) * easeOutCubic(this.t)) * v.zoom
    ctx.globalAlpha = (1 - this.t) * 0.9
    ctx.strokeStyle = this.color
    ctx.lineWidth = Math.max(1, this.width * v.zoom)
    ctx.beginPath()
    ctx.arc(Math.round(sx), Math.round(sy), r, 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/** jagged lightning bolt striking down onto the planet */
export class Lightning implements Effect {
  layer: 'front' = 'front'
  t = 0
  pts: [number, number][] = []
  side = rng() < 0.5 ? -1 : 1
  constructor(private anchor: Anchor, private onStrike?: () => void) {}
  update(dt: number) {
    this.t += dt
    if (this.t > 0.05 && this.pts.length && this.onStrike) {
      this.onStrike()
      this.onStrike = undefined
    }
    return this.t < 0.45
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const a = this.anchor()
    if (!this.pts.length) {
      let x = a.x + this.side * a.r * 0.4
      let y = a.y - a.r * 2.2
      this.pts.push([x, y])
      while (y < a.y - a.r * 0.55) {
        x += rand(-4, 4)
        y += rand(3, 7)
        this.pts.push([x, y])
      }
    }
    const flick = Math.floor(this.t * 30) % 3 !== 1
    if (!flick) return
    ctx.globalAlpha = clamp01(1 - this.t / 0.45)
    ctx.strokeStyle = '#fff7c2'
    ctx.lineWidth = Math.max(1, v.zoom)
    ctx.beginPath()
    for (let i = 0; i < this.pts.length; i++) {
      const [sx, sy] = toScreen(v, this.pts[i][0], this.pts[i][1])
      if (i === 0) ctx.moveTo(Math.round(sx), Math.round(sy))
      else ctx.lineTo(Math.round(sx), Math.round(sy))
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/** a beam of light from a planet to the star */
export class Beam implements Effect {
  layer: 'back' = 'back'
  t = 0
  constructor(private from: Anchor, private to: Anchor, private color: string, private duration = 1.4) {}
  update(dt: number) {
    this.t += dt / this.duration
    return this.t < 1
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const a = this.from()
    const b = this.to()
    const grow = easeOutCubic(Math.min(1, this.t * 2))
    const fade = this.t < 0.5 ? 1 : 1 - (this.t - 0.5) * 2
    const [x0, y0] = toScreen(v, a.x, a.y)
    const [x1, y1] = toScreen(v, lerp(a.x, b.x, grow), lerp(a.y, b.y, grow))
    ctx.globalAlpha = fade * 0.9
    ctx.strokeStyle = this.color
    ctx.lineWidth = Math.max(1, Math.round(2 * v.zoom))
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    ctx.lineWidth = Math.max(1, Math.round(6 * v.zoom))
    ctx.globalAlpha = fade * 0.25
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/** rocket: launches up from the planet then curves toward a target */
export class Rocket implements Effect {
  layer: 'front' = 'front'
  t = 0
  x = 0
  y = 0
  started = false
  constructor(private from: Anchor, private to: Anchor, private particles: Particles, private onArrive?: () => void, private duration = 3.2, private flame = '#ffb347') {}
  update(dt: number) {
    this.t += dt / this.duration
    const a = this.from()
    const b = this.to()
    const t = this.t
    // phase 1: rise straight up (0..0.35), phase 2: arc to target
    const up = { x: a.x, y: a.y - a.r * 3.2 }
    if (t < 0.35) {
      const k = easeInCubic(t / 0.35)
      this.x = lerp(a.x, up.x, k)
      this.y = lerp(a.y - a.r * 0.6, up.y, k)
    } else {
      const k = easeInOutCubic((t - 0.35) / 0.65)
      const cx = (up.x + b.x) / 2 + (b.y - up.y) * 0.25
      const cy = (up.y + b.y) / 2 - Math.abs(b.x - up.x) * 0.25
      const u = 1 - k
      this.x = u * u * up.x + 2 * u * k * cx + k * k * b.x
      this.y = u * u * up.y + 2 * u * k * cy + k * k * b.y
    }
    for (let i = 0; i < 2; i++) this.particles.spawn({ x: this.x + rand(-1, 1), y: this.y + 3, vx: rand(-6, 6), vy: rand(10, 30), max: rand(0.3, 0.7), color: i ? this.flame : '#fff1c9', size: 1, fade: 'flicker' })
    if (t >= 1) {
      this.onArrive?.()
      return false
    }
    return true
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const [sx, sy] = toScreen(v, this.x, this.y)
    const px = Math.max(1, Math.round(v.zoom * 0.9))
    const s = spriteSize(SHIPS.rocket)
    drawSprite(ctx, SHIPS.rocket, sx - (s.w * px) / 2, sy - s.h * px, px, { m: '#e8e8f0', l: '#7fd7ff', x: '#ff6b6b', f: Math.random() < 0.5 ? '#ffb347' : '#fff1c9' })
  }
}

/** spacecraft arriving from the edge of the scene to a target point */
export class ArrivalShip implements Effect {
  layer: 'front' = 'front'
  t = 0
  start: { x: number; y: number }
  constructor(private target: Anchor, private particles: Particles, private onArrive?: () => void, private duration = 2.6) {
    const a = target()
    const ang = rng() * TAU
    this.start = { x: a.x + Math.cos(ang) * 420, y: a.y + Math.sin(ang) * 420 }
  }
  update(dt: number) {
    this.t += dt / this.duration
    if (this.t >= 1) {
      this.onArrive?.()
      return false
    }
    return true
  }
  pos() {
    const a = this.target()
    const k = easeOutCubic(this.t)
    return { x: lerp(this.start.x, a.x, k), y: lerp(this.start.y, a.y - a.r * 1.4, k) }
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const p = this.pos()
    const [sx, sy] = toScreen(v, p.x, p.y)
    const px = Math.max(1, Math.round(v.zoom * 0.8))
    const s = spriteSize(SHIPS.shuttle)
    if (this.t < 0.9) this.particles.spawn({ x: p.x + rand(-1, 1), y: p.y + 2, vx: rand(-4, 4), vy: rand(4, 12), max: 0.4, color: '#9fe8ff', size: 1 })
    ctx.globalAlpha = this.t > 0.85 ? 1 - (this.t - 0.85) / 0.15 : 1
    drawSprite(ctx, SHIPS.shuttle, sx - (s.w * px) / 2, sy - (s.h * px) / 2, px, { m: '#d9dbe8', l: '#9fe8ff', f: Math.random() < 0.5 ? '#9fe8ff' : '#ffffff' })
    ctx.globalAlpha = 1
  }
}

/** a little ufo that wobbles around and (optionally) crashes into the planet */
export class Ufo implements Effect {
  layer: 'front' = 'front'
  t = 0
  x = 0
  y = 0
  ang = rng() * TAU
  constructor(private anchor: Anchor, private particles: Particles, private crash: boolean, private onCrash?: () => void) {
    const a = anchor()
    this.x = a.x + Math.cos(this.ang) * a.r * 2.6
    this.y = a.y + Math.sin(this.ang) * a.r * 2.6
  }
  update(dt: number) {
    this.t += dt
    const a = this.anchor()
    if (this.crash) {
      const k = clamp01(this.t / 1.6)
      const tx = a.x + Math.cos(this.ang + 0.6) * a.r * 0.5
      const ty = a.y + Math.sin(this.ang + 0.6) * a.r * 0.5
      this.x = lerp(this.x, tx, k * 0.08)
      this.y = lerp(this.y, ty, k * 0.08) + Math.sin(this.t * 25) * 0.6
      if (this.t > 0.2) this.particles.spawn({ x: this.x, y: this.y, vx: rand(-5, 5), vy: rand(-8, -2), max: 0.8, color: '#8a8a95', size: 1 })
      if (this.t > 1.6) {
        for (let i = 0; i < 18; i++) this.particles.spawn({ x: this.x, y: this.y, vx: rand(-40, 40), vy: rand(-45, 10), max: rand(0.4, 1), color: i % 3 ? '#ffb347' : '#ffffff', size: 1, gravity: 40 })
        this.onCrash?.()
        return false
      }
      return true
    }
    this.ang += dt * 0.9
    this.x = a.x + Math.cos(this.ang) * a.r * (2.2 + Math.sin(this.t * 2) * 0.3)
    this.y = a.y + Math.sin(this.ang) * a.r * 0.9 - a.r * 1.4
    return this.t < 6
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const [sx, sy] = toScreen(v, this.x, this.y)
    const px = Math.max(1, Math.round(v.zoom * 0.8))
    const s = spriteSize(SHIPS.ufo)
    drawSprite(ctx, SHIPS.ufo, sx - (s.w * px) / 2, sy - (s.h * px) / 2, px, { m: '#b8b8c8', l: Math.floor(this.t * 6) % 2 ? '#8dff9a' : '#ffe27a', x: '#ff6b6b' })
  }
}

/** meteor streaking in and hitting the planet */
export class Meteor implements Effect {
  layer: 'front' = 'front'
  t = 0
  from: { x: number; y: number }
  to: { x: number; y: number }
  constructor(private anchor: Anchor, private particles: Particles, private onImpact?: () => void) {
    const a = anchor()
    const ang = rng() * TAU
    this.from = { x: a.x + Math.cos(ang) * a.r * 5, y: a.y + Math.sin(ang) * a.r * 5 }
    const hit = ang + Math.PI + rand(-0.5, 0.5)
    this.to = { x: a.x + Math.cos(hit) * a.r * 0.5, y: a.y + Math.sin(hit) * a.r * 0.5 }
  }
  update(dt: number) {
    this.t += dt / 0.7
    const x = lerp(this.from.x, this.to.x, easeInCubic(this.t))
    const y = lerp(this.from.y, this.to.y, easeInCubic(this.t))
    this.particles.spawn({ x, y, vx: rand(-3, 3), vy: rand(-3, 3), max: 0.35, color: Math.random() < 0.5 ? '#ffb347' : '#ffe9b0', size: 1 })
    if (this.t >= 1) {
      for (let i = 0; i < 14; i++) this.particles.spawn({ x: this.to.x, y: this.to.y, vx: rand(-30, 30), vy: rand(-30, 30), max: rand(0.3, 0.8), color: i % 2 ? '#c9b8a0' : '#ffffff', size: 1, drag: 2 })
      this.onImpact?.()
      return false
    }
    return true
  }
  draw(ctx: CanvasRenderingContext2D, v: View) {
    const x = lerp(this.from.x, this.to.x, easeInCubic(this.t))
    const y = lerp(this.from.y, this.to.y, easeInCubic(this.t))
    const [sx, sy] = toScreen(v, x, y)
    const s = Math.max(1, Math.round(2 * v.zoom))
    ctx.fillStyle = '#ffd9a0'
    ctx.fillRect(Math.round(sx), Math.round(sy), s, s)
  }
}

export function firework(particles: Particles, x: number, y: number, color: string, n = 26, speed = 55) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.1, 0.1)
    const sp = speed * rand(0.6, 1)
    particles.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rand(0.7, 1.3), color: i % 4 === 0 ? '#ffffff' : color, size: 1, gravity: 18, drag: 1.4, twinkle: true })
  }
}

export function puff(particles: Particles, x: number, y: number, color: string, n = 8, spread = 16) {
  for (let i = 0; i < n; i++) particles.spawn({ x, y, vx: rand(-spread, spread), vy: rand(-spread, spread), max: rand(0.3, 0.8), color, size: 1, drag: 3 })
}

/** rising smoke from a broken structure */
export function smoke(particles: Particles, x: number, y: number) {
  particles.spawn({ x: x + rand(-1, 1), y, vx: rand(-2, 2), vy: rand(-9, -4), max: rand(0.8, 1.6), color: Math.random() < 0.5 ? '#6b6b78' : '#8f8fa0', size: 1, drag: 0.5 })
}

/** tiny happy sparkles above a spot (workers celebrating / repaired) */
export function sparkle(particles: Particles, x: number, y: number, color = '#fff6b0', n = 6) {
  for (let i = 0; i < n; i++) particles.spawn({ x: x + rand(-3, 3), y: y + rand(-3, 1), vx: rand(-4, 4), vy: rand(-14, -6), max: rand(0.5, 1), color, size: 1, twinkle: true })
}
