import type { AgentSession, UniverseEvent, UniverseConfig } from '@shared/types'
import { Planet } from './planet'
import { Particles, type Effect, type View, toScreen, Ring, Beam, Rocket, ArrivalShip, firework, puff, sparkle } from './effects'
import { REACTIONS, personalityTick } from './reactions'
import { mulberry32, TAU, lerp, clamp, easeInOutCubic } from './prng'
import { rgb } from './palette'
import { sfx } from '../audio/sound'
import { drawSprite, SHIPS } from './sprites'

const ORBIT_SQUASH = 0.7
const ACTIVE_STATUSES = new Set(['spawning', 'exploring', 'building', 'thinking', 'waiting', 'trouble'])

interface BgStar {
  x: number
  y: number
  layer: number
  size: number
  tw: number
  color: string
}
interface Nebula {
  x: number
  y: number
  r: number
  color: string
}
interface Streak {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
  len: number
}

export interface SceneCallbacks {
  onFocus(id: string | null): void
  onHover(id: string | null): void
  onToast(text: string, kind: 'info' | 'celebrate' | 'trouble', sub?: string): void
}

export class Scene {
  planets = new Map<string, Planet>()
  particles = new Particles()
  effects: Effect[] = []
  view: View = { x: 0, y: 0, zoom: 1, W: 320, H: 180 }
  camTarget = { x: 0, y: 0, zoom: 1 }
  focused: string | null = null
  hovered: string | null = null
  config: UniverseConfig
  private stars: BgStar[] = []
  private nebulae: Nebula[] = []
  private streaks: Streak[] = []
  private rng = mulberry32(777)
  private last = 0
  private raf = 0
  private timer = 0
  private running = false
  private buf: HTMLCanvasElement
  private bctx: CanvasRenderingContext2D
  private octx: CanvasRenderingContext2D
  private pixelScale = 3
  private starPulse = 0
  private starBoost = 0
  private missionT = -1
  private missionShips: { from: Planet; t: number }[] = []
  private personalityTimer = 4
  private streakTimer = 3
  private dpr = 1
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null
  private userZoom = 1
  private autoZoom = 1
  private sparkleWorld = 0
  private formationAngle = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    config: UniverseConfig,
    private cb: SceneCallbacks,
  ) {
    this.config = config
    this.buf = document.createElement('canvas')
    this.bctx = this.buf.getContext('2d')!
    this.octx = overlay.getContext('2d')!
    this.buildBackground()
    this.resize()
    window.addEventListener('resize', this.resize)
    canvas.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  destroy() {
    this.running = false
    cancelAnimationFrame(this.raf)
    clearTimeout(this.timer)
    window.removeEventListener('resize', this.resize)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  setConfig(c: UniverseConfig) {
    const q = c.visualQuality !== this.config.visualQuality
    this.config = c
    this.particles.max = c.visualQuality === 'low' ? 300 : c.visualQuality === 'medium' ? 600 : 900
    if (q) this.resize()
  }

  get intensity() {
    return this.config.animationIntensity
  }

  // ------------------------------------------------------------ background
  private buildBackground() {
    const r = this.rng
    this.stars = []
    for (let i = 0; i < 260; i++) {
      const layer = r() < 0.5 ? 0.25 : r() < 0.6 ? 0.5 : 0.8
      const c = r()
      this.stars.push({ x: r() * 4000, y: r() * 4000, layer, size: r() < 0.9 ? 1 : 2, tw: r() * TAU, color: c < 0.7 ? '#ffffff' : c < 0.85 ? '#ffe9b0' : '#b8d8ff' })
    }
    this.nebulae = []
    const cols = ['rgba(90,60,140,0.10)', 'rgba(40,90,140,0.10)', 'rgba(140,70,110,0.08)', 'rgba(60,120,110,0.08)']
    for (let i = 0; i < 9; i++) this.nebulae.push({ x: (r() - 0.5) * 1800, y: (r() - 0.5) * 1200, r: 80 + r() * 160, color: cols[i % cols.length] })
  }

  // ------------------------------------------------------------ sizing
  resize = () => {
    const ps = this.config.visualQuality === 'high' ? 3 : this.config.visualQuality === 'medium' ? 4 : 5
    this.pixelScale = ps
    const w = window.innerWidth
    const h = window.innerHeight
    this.buf.width = Math.ceil(w / ps)
    this.buf.height = Math.ceil(h / ps)
    this.canvas.width = this.buf.width
    this.canvas.height = this.buf.height
    this.canvas.style.width = `${this.buf.width * ps}px`
    this.canvas.style.height = `${this.buf.height * ps}px`
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = w * this.dpr
    this.overlay.height = h * this.dpr
    this.overlay.style.width = `${w}px`
    this.overlay.style.height = `${h}px`
    this.view.W = this.buf.width
    this.view.H = this.buf.height
    this.bctx.imageSmoothingEnabled = false
    const ctx = this.canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
  }

  // ------------------------------------------------------------ input
  private toWorld(clientX: number, clientY: number): [number, number] {
    const v = this.view
    const sx = clientX / this.pixelScale
    const sy = clientY / this.pixelScale
    return [(sx - v.W / 2) / v.zoom + v.x, (sy - v.H / 2) / v.zoom + v.y]
  }
  private planetAt(clientX: number, clientY: number): Planet | null {
    const [wx, wy] = this.toWorld(clientX, clientY)
    let best: Planet | null = null
    let bd = Infinity
    for (const p of this.planets.values()) {
      if (!p.visible) continue
      const d = Math.hypot(p.x - wx, p.y - wy)
      if (d <= p.radius * 1.4 + 6 / this.view.zoom && d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }
  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, cx: this.camTarget.x, cy: this.camTarget.y, moved: false }
  }
  private onMove = (e: PointerEvent) => {
    if (this.drag) {
      const dx = e.clientX - this.drag.x
      const dy = e.clientY - this.drag.y
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true
      if (this.drag.moved && !this.focused) {
        this.camTarget.x = this.drag.cx - dx / this.pixelScale / this.view.zoom
        this.camTarget.y = this.drag.cy - dy / this.pixelScale / this.view.zoom
      }
      return
    }
    const p = this.planetAt(e.clientX, e.clientY)
    const id = p?.id ?? null
    if (id !== this.hovered) {
      this.hovered = id
      for (const pl of this.planets.values()) pl.hover = pl.id === id
      this.canvas.style.cursor = id ? 'pointer' : 'grab'
      this.cb.onHover(id)
    }
  }
  private onUp = (e: PointerEvent) => {
    if (!this.drag) return
    const moved = this.drag.moved
    this.drag = null
    if (moved) return
    if ((e.target as HTMLElement)?.closest?.('.ui')) return
    const p = this.planetAt(e.clientX, e.clientY)
    this.focus(p?.id ?? null)
  }
  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (this.focused) return
    this.userZoom = clamp(this.userZoom * Math.exp(-e.deltaY * 0.0012), 0.5, 2.5)
  }
  private onVisibility = () => {
    // switching scheduler: cancel whichever is pending and re-arm
    cancelAnimationFrame(this.raf)
    clearTimeout(this.timer)
    this.running = false
    this.start()
  }

  focus(id: string | null) {
    this.focused = id
    this.cb.onFocus(id)
  }

  // ------------------------------------------------------------ sessions
  syncSessions(sessions: Record<string, AgentSession>, now: number) {
    for (const s of Object.values(sessions)) {
      let p = this.planets.get(s.id)
      if (!p) {
        p = new Planet(s, this.rng() * TAU)
        this.planets.set(s.id, p)
        const active = ACTIVE_STATUSES.has(s.status)
        p.ring = active ? 'active' : 'completed'
        if (active && now - s.startedAt < 20_000) {
          this.arrive(p)
        } else {
          p.visible = true
          p.spawn = 1
        }
      } else {
        p.setSession(s, now)
        const shouldBeActive = ACTIVE_STATUSES.has(s.status)
        if (shouldBeActive && p.ring === 'completed' && !p.visible) p.ring = 'active'
      }
    }
    for (const id of [...this.planets.keys()]) if (!sessions[id]) this.planets.delete(id)
    if (this.focused && !this.planets.has(this.focused)) this.focus(null)
  }

  handleEvent(e: UniverseEvent, session: AgentSession, now: number) {
    let p = this.planets.get(session.id)
    if (!p) {
      p = new Planet(session, this.rng() * TAU)
      this.planets.set(session.id, p)
      this.arrive(p)
    }
    p.setSession(session, now)
    const fn = REACTIONS[e.type]
    if (fn && this.intensity > 0) fn(this, p, e)
  }

  addEffect(e: Effect) {
    if (this.effects.length < 120) this.effects.push(e)
  }

  /** a ship flies in, then the planet materializes */
  arrive(p: Planet) {
    p.visible = false
    p.spawn = 0
    p.ring = 'active'
    this.layout(0)
    p.orbitRadius = p.targetRadius
    this.updatePlanetPosition(p)
    this.addEffect(
      new ArrivalShip(p.anchor, this.particles, () => {
        p.visible = true
        puff(this.particles, p.x, p.y, rgb(p.surface.palette.atmosphere), 18, 30)
        this.addEffect(new Ring(p.anchor, rgb(p.surface.palette.atmosphere, 0.9), 1.4, 2.4))
        sfx.spawn()
        this.cb.onToast(`${p.session.name} has arrived`, 'info', p.session.task || p.session.project)
      }),
    )
  }

  /** a resting/completed world gets a new task: it comes back to the active ring */
  reawaken(p: Planet) {
    p.ring = 'active'
    p.targetScale = 1
    this.addEffect(new Ring(p.anchor, 'rgba(255,255,255,0.8)', 1.2, 2))
    const a = p.anchor()
    sparkle(this.particles, a.x, a.y - a.r, '#ffffff', 10)
    sfx.spawn()
  }

  milestoneRocket(p: Planet) {
    const star = () => ({ x: 0, y: 0, r: 10 })
    this.addEffect(new Rocket(p.anchor, star, this.particles, () => { this.starBoost = Math.max(this.starBoost, 0.6); firework(this.particles, 0, -30, '#ffe9a0', 16, 30) }, 3.4))
    this.addEffect(new Ring(p.anchor, rgb(p.surface.palette.light, 0.9), 1, 1.6))
  }

  /** THE event: a world finished its task */
  celebrate(p: Planet) {
    if (!this.config.completionEffects || p.session.toolCount === 0) {
      this.retire(p, false)
      return
    }
    const pal = p.surface.palette
    const lightC = rgb(pal.light)
    p.paused = 0.7
    p.nudge(0.8)
    const at = (ms: number, fn: () => void) => setTimeout(fn, ms / Math.max(0.35, this.intensity))
    // 1. brief pause, then 2. every light turns on
    at(700, () => {
      p.lightsBoost = 1
      this.addEffect(new Ring(p.anchor, lightC, 1.4, 2.2, 2))
      sfx.complete()
    })
    // 3. fireworks
    for (let i = 0; i < 7; i++) {
      at(1200 + i * 380, () => {
        const a = p.anchor()
        const ang = Math.random() * TAU
        firework(this.particles, a.x + Math.cos(ang) * a.r * 1.6, a.y + Math.sin(ang) * a.r * 1.6 - a.r * 0.6, i % 2 ? lightC : rgb(pal.atmosphere), 22, 45)
      })
    }
    // 4. rocket launch → 5. beam to the star
    at(2200, () => {
      const star = () => ({ x: 0, y: 0, r: 10 })
      this.addEffect(
        new Rocket(p.anchor, star, this.particles, () => {
          this.starBoost = Math.max(this.starBoost, 1)
          firework(this.particles, 0, -20, '#ffffff', 30, 55)
          this.addEffect(new Beam(p.anchor, star, rgb(pal.atmosphere), 1.6))
        }, 3.2, lightC),
      )
    })
    // 6. drift out to the completed orbit
    at(6000, () => this.retire(p, true))
    this.cb.onToast(`${p.session.name} finished`, 'celebrate', p.session.task || undefined)
  }

  retire(p: Planet, gentle: boolean) {
    p.ring = 'completed'
    p.targetScale = 0.72
    if (gentle) {
      const a = p.anchor()
      sparkle(this.particles, a.x, a.y - a.r, '#ffffff', 8)
    }
  }

  /** every world finished: universe-wide secret ending */
  missionComplete() {
    if (!this.config.completionEffects) return
    this.missionT = 0
    this.missionShips = [...this.planets.values()].filter((p) => p.visible && p.ring === 'completed').slice(0, 24).map((p) => ({ from: p, t: -Math.random() * 1.2 }))
    sfx.mission()
  }

  // ------------------------------------------------------------ layout
  private layout(dt: number) {
    this.formationAngle += 0.02 * dt * this.intensity
    const active = [...this.planets.values()].filter((p) => p.ring === 'active')
    const done = [...this.planets.values()].filter((p) => p.ring === 'completed')
    const base = Math.min(this.view.W, this.view.H) * 0.34
    const n = active.length
    active.sort((a, b) => a.session.startedAt - b.session.startedAt)
    const perRing = n <= 5 ? n : Math.ceil(n / 2)
    active.forEach((p, i) => {
      const ringIdx = n <= 5 ? 0 : i % 2
      p.targetRadius = base + ringIdx * base * 0.55 + (i % 3) * 6
      // keep the worlds spread out: ease each angle toward an evenly spaced slot
      // slots rotate together slowly, so the formation orbits as a whole
      const slot = ((i % perRing) / perRing) * TAU + ringIdx * (TAU / perRing) * 0.5 + this.formationAngle * (ringIdx ? -1 : 1)
      const drift = ((slot - p.orbitAngle + Math.PI * 3) % TAU) - Math.PI
      p.orbitAngle += drift * Math.min(1, dt * 0.6)
      p.targetScale = 1
    })
    const rows = done.length > 14 ? 2 : 1
    const rowN = Math.ceil(done.length / rows)
    done.sort((a, b) => (a.session.endedAt ?? a.session.lastEventAt) - (b.session.endedAt ?? b.session.lastEventAt))
    done.forEach((p, i) => {
      const row = Math.floor(i / rowN)
      p.targetRadius = base * (1.8 + row * 0.45) + (i % 2) * 5
      const slot = ((i % rowN) / rowN) * TAU + row * 0.3 - this.formationAngle * 0.3
      const drift = ((slot - p.orbitAngle + Math.PI * 3) % TAU) - Math.PI
      p.orbitAngle += drift * Math.min(1, dt * 0.5)
      p.targetScale = done.length > 20 ? 0.5 : done.length > 10 ? 0.6 : 0.72
    })
    // fit everything into view
    const outer = done.length ? base * (1.8 + (rows - 1) * 0.45) + 34 : n > 5 ? base * 1.55 + 30 : base + 34
    const fit = Math.min(this.view.W / 2 / (outer * 1.08), (this.view.H / 2 - 22) / (outer * ORBIT_SQUASH))
    this.autoZoom = clamp(fit, 0.35, 1.6)
  }

  private updatePlanetPosition(p: Planet) {
    p.x = Math.cos(p.orbitAngle) * p.orbitRadius
    p.y = Math.sin(p.orbitAngle) * p.orbitRadius * ORBIT_SQUASH
  }

  // ------------------------------------------------------------ loop
  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const tick = (t: number) => {
      if (!this.running) return
      // hidden tabs get throttled timers; allow bigger steps there so the sim keeps real time
      const dt = Math.min(document.hidden ? 1 : 0.1, (t - this.last) / 1000)
      this.last = t
      this.update(dt, t)
      this.render(t)
      this.schedule(tick)
    }
    this.schedule(tick)
  }

  /** full speed when visible; a slow 10fps heartbeat when the tab is hidden */
  private schedule(tick: (t: number) => void) {
    if (document.hidden) this.timer = window.setTimeout(() => tick(performance.now()), 100)
    else this.raf = requestAnimationFrame(tick)
  }

  private update(dt: number, now: number) {
    this.layout(dt)
    for (const p of this.planets.values()) {
      p.starX = 0
      p.starY = 0
      p.update(dt, now, this.intensity)
      this.updatePlanetPosition(p)
    }
    // camera
    const f = this.focused ? this.planets.get(this.focused) : null
    if (f && f.visible) {
      this.camTarget = { x: f.x, y: f.y + f.radius * 0.35, zoom: clamp(52 / f.radius, 2, 3.4) }
    } else {
      this.camTarget.zoom = this.autoZoom * this.userZoom
      if (!this.drag) {
        this.camTarget.x = lerp(this.camTarget.x, 0, 1 - Math.exp(-dt * 0.4))
        this.camTarget.y = lerp(this.camTarget.y, 0, 1 - Math.exp(-dt * 0.4))
      }
    }
    const k = 1 - Math.exp(-dt * 2.2)
    this.view.x = lerp(this.view.x, this.camTarget.x, k)
    this.view.y = lerp(this.view.y, this.camTarget.y, k)
    this.view.zoom = lerp(this.view.zoom, this.camTarget.zoom, k)
    // effects & particles
    this.particles.update(dt)
    let w = 0
    for (let i = 0; i < this.effects.length; i++) {
      const e = this.effects[i]
      if (e.update(dt, now)) this.effects[w++] = e
    }
    this.effects.length = w
    this.starPulse += dt
    this.starBoost *= Math.exp(-dt * 0.5)
    // ambient shooting stars & personality mischief
    this.streakTimer -= dt
    if (this.streakTimer <= 0 && this.intensity > 0.1) {
      this.streakTimer = 4 + this.rng() * 9
      const y = (this.rng() - 0.5) * this.view.H * 1.2
      const x = -this.view.W * 0.8 + this.rng() * this.view.W * 1.6
      const speed = 160 + this.rng() * 120
      this.streaks.push({ x, y, vx: speed * (this.rng() < 0.5 ? 1 : -1) * 0.8, vy: speed * 0.5, life: 1.1, color: this.rng() < 0.15 ? '#9fe8ff' : '#ffffff', len: 8 + this.rng() * 8 })
    }
    for (const s of this.streaks) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.life -= dt
    }
    this.streaks = this.streaks.filter((s) => s.life > 0)
    this.personalityTimer -= dt
    if (this.personalityTimer <= 0) {
      this.personalityTimer = 6 + this.rng() * 10
      const list = [...this.planets.values()].filter((p) => p.ring === 'active')
      if (list.length) personalityTick(this, list[Math.floor(this.rng() * list.length)])
    }
    // mission complete choreography
    if (this.missionT >= 0) {
      this.missionT += dt
      this.starBoost = Math.max(this.starBoost, Math.min(1.4, this.missionT * 0.6))
      for (const s of this.missionShips) {
        s.t += dt / 3
        if (s.t >= 1 && s.t < 1 + dt / 3 + 0.001) firework(this.particles, (this.rng() - 0.5) * 40, -20 - this.rng() * 30, '#ffffff', 18, 40)
      }
      if (this.missionT > 3 && this.missionT < 8 && this.rng() < 0.35) {
        const a = this.rng() * TAU
        const r = 60 + this.rng() * 220
        firework(this.particles, Math.cos(a) * r, Math.sin(a) * r * ORBIT_SQUASH, ['#ffe9a0', '#9fe8ff', '#ffb3d9', '#b8ffcf'][Math.floor(this.rng() * 4)], 20, 40)
      }
      if (this.missionT > 11) {
        this.missionT = -1
        this.missionShips = []
      }
    }
    this.sparkleWorld += dt
  }

  private render(now: number) {
    const ctx = this.bctx
    const v = this.view
    const W = v.W
    const H = v.H
    ctx.fillStyle = '#07091a'
    ctx.fillRect(0, 0, W, H)
    // nebulae & parallax stars
    for (const n of this.nebulae) {
      const sx = W / 2 + (n.x - v.x * 0.15) * v.zoom * 0.6
      const sy = H / 2 + (n.y - v.y * 0.15) * v.zoom * 0.6
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, n.r * v.zoom)
      g.addColorStop(0, n.color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - n.r * v.zoom, sy - n.r * v.zoom, n.r * 2 * v.zoom, n.r * 2 * v.zoom)
    }
    const t = now / 1000
    for (const s of this.stars) {
      // wrap-around parallax: the field stays evenly dense wherever the camera goes
      const zf = 0.5 + 0.5 * v.zoom
      const sx = (((s.x - v.x * s.layer * zf) % W) + W) % W
      const sy = (((s.y - v.y * s.layer * zf) % H) + H) % H
      const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + s.layer) + s.tw)
      ctx.globalAlpha = tw * (0.35 + s.layer * 0.7)
      ctx.fillStyle = s.color
      ctx.fillRect(Math.round(sx), Math.round(sy), s.size, s.size)
    }
    ctx.globalAlpha = 1
    for (const s of this.streaks) {
      const [sx, sy] = toScreen(v, s.x, s.y)
      ctx.strokeStyle = s.color
      ctx.globalAlpha = Math.min(1, s.life)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx - (s.vx / 200) * s.len, sy - (s.vy / 200) * s.len)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    // orbit paths
    const active = [...this.planets.values()].filter((p) => p.ring === 'active' && p.visible)
    const done = [...this.planets.values()].filter((p) => p.ring === 'completed' && p.visible)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    const [cx0, cy0] = toScreen(v, 0, 0)
    const drawnRadii = new Set<number>()
    for (const p of [...active, ...done]) {
      const r = Math.round(p.orbitRadius)
      if (drawnRadii.has(r)) continue
      drawnRadii.add(r)
      ctx.setLineDash(p.ring === 'completed' ? [2, 5] : [])
      ctx.beginPath()
      ctx.ellipse(cx0, cy0, r * v.zoom, r * v.zoom * ORBIT_SQUASH, 0, 0, TAU)
      ctx.stroke()
    }
    ctx.setLineDash([])
    // back effects, then planets sorted by y (depth), then front effects
    for (const e of this.effects) if (e.layer === 'back') e.draw(ctx, v)
    this.drawStar(ctx, cx0, cy0, now)
    const sorted = [...this.planets.values()].filter((p) => p.visible).sort((a, b) => a.y - b.y)
    // planets "behind" the star (upper half) draw before it: redraw star over them cheaply
    for (const p of sorted) {
      p.draw(ctx, v, 'back', now, this.particles, this.intensity)
      p.draw(ctx, v, 'main', now, this.particles, this.intensity)
      p.draw(ctx, v, 'front', now, this.particles, this.intensity)
    }
    for (const s of this.missionShips) {
      if (s.t < 0 || s.t > 1) continue
      const k = easeInOutCubic(s.t)
      const x = lerp(s.from.x, 0, k)
      const y = lerp(s.from.y - s.from.radius, -6, k)
      const [sx, sy] = toScreen(v, x, y)
      const px = Math.max(1, Math.round(v.zoom * 0.8))
      drawSprite(ctx, SHIPS.scout, sx - px * 1.5, sy - px, px, { m: '#e6e6f0', l: '#ffd86b', f: Math.random() < 0.5 ? '#ffb347' : '#fff1c9' })
    }
    this.particles.draw(ctx, v)
    for (const e of this.effects) if (e.layer === 'front') e.draw(ctx, v)
    // blit the pixel buffer
    const out = this.canvas.getContext('2d')!
    out.drawImage(this.buf, 0, 0)
    this.renderOverlay(now)
  }

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, now: number) {
    const v = this.view
    const base = 15 * v.zoom
    const pulse = 1 + Math.sin(this.starPulse * 1.3) * 0.04 + this.starBoost * 0.25
    const r = base * pulse
    // corona
    const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * (3.2 + this.starBoost * 1.5))
    g.addColorStop(0, `rgba(255,214,107,${0.35 + this.starBoost * 0.3})`)
    g.addColorStop(0.5, 'rgba(255,170,80,0.08)')
    g.addColorStop(1, 'rgba(255,140,60,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - r * 5, cy - r * 5, r * 10, r * 10)
    // rays (pixel spokes that slowly rotate)
    const rays = 8
    ctx.fillStyle = 'rgba(255,220,130,0.35)'
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU + now / 9000
      const len = r * (1.5 + 0.4 * Math.sin(now / 700 + i)) + this.starBoost * r
      for (let d = r * 1.15; d < len; d += Math.max(1, v.zoom)) {
        ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), Math.max(1, Math.round(v.zoom * 0.8)), Math.max(1, Math.round(v.zoom * 0.8)))
      }
    }
    // body: layered pixel discs
    const disc = (rad: number, color: string) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, TAU)
      ctx.fill()
    }
    disc(r, '#ff9a3c')
    disc(r * 0.86, '#ffb347')
    disc(r * 0.68, '#ffd86b')
    disc(r * 0.42, '#fff1b8')
    // sunspots / flares
    const px = Math.max(1, Math.round(v.zoom))
    ctx.fillStyle = '#ff9a3c'
    for (let i = 0; i < 5; i++) {
      const a = now / 4000 + i * 1.3
      const d = r * (0.4 + (i % 3) * 0.18)
      ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a * 1.1) * d * 0.8), px, px)
    }
    if (Math.floor(now / 350) % 7 === 0) {
      ctx.fillStyle = '#fff7d6'
      const a = now / 500
      ctx.fillRect(Math.round(cx + Math.cos(a) * r * 1.05), Math.round(cy + Math.sin(a) * r * 1.05), px * 2, px)
    }
  }

  /** crisp text overlay (labels, mission text) drawn at device resolution */
  private renderOverlay(now: number) {
    const o = this.octx
    const dpr = this.dpr
    const W = this.overlay.width
    const H = this.overlay.height
    o.clearRect(0, 0, W, H)
    o.setTransform(dpr, 0, 0, dpr, 0, 0)
    const ps = this.pixelScale
    const v = this.view
    if (this.config.showLabels) {
      o.font = '9px Silkscreen, monospace'
      o.textAlign = 'center'
      o.textBaseline = 'top'
      for (const p of this.planets.values()) {
        if (!p.visible || p.spawn < 0.9) continue
        const [sx, sy] = toScreen(v, p.x, p.y)
        const x = sx * ps
        const y = (sy + p.radius * v.zoom + 5) * ps
        const done = p.ring === 'completed'
        const dim = done || p.status === 'offline'
        o.fillStyle = dim ? 'rgba(200,205,230,0.45)' : 'rgba(235,238,255,0.92)'
        if (done && this.planets.size > 14 && !p.hover) continue
        o.fillText(p.session.name.toUpperCase(), x, y)
        if (!done && p.session.task && (p.hover || this.focused === p.id || this.planets.size <= 6)) {
          o.font = '12px VT323, monospace'
          o.fillStyle = 'rgba(180,190,220,0.8)'
          const task = p.session.task.length > 34 ? p.session.task.slice(0, 33) + '…' : p.session.task
          o.fillText(task, x, y + 11)
          o.font = '9px Silkscreen, monospace'
        }
      }
    }
    if (this.missionT >= 0) {
      const t = this.missionT
      const a = t < 3 ? 0 : t < 4.2 ? (t - 3) / 1.2 : t < 9 ? 1 : Math.max(0, 1 - (t - 9) / 2)
      if (a > 0) {
        o.globalAlpha = a
        o.textAlign = 'center'
        o.font = '18px Silkscreen, monospace'
        o.fillStyle = '#fff1b8'
        o.shadowColor = 'rgba(255,200,100,0.8)'
        o.shadowBlur = 12
        const [sx, sy] = toScreen(v, 0, 0)
        const ty = sy * ps + Math.max(120, 105 * v.zoom * (ps / 3))
        o.fillText('MISSION COMPLETE', sx * ps, ty)
        o.shadowBlur = 0
        o.font = '13px VT323, monospace'
        o.fillStyle = 'rgba(220,225,255,0.8)'
        o.fillText('every world is at rest', sx * ps, ty + 24)
        o.globalAlpha = 1
      }
    }
    void now
  }
}
