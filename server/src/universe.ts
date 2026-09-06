import { basename } from 'node:path'
import type { AgentSession, AgentStatus, MissionRecord, ServerMessage, UniverseConfig, UniverseEvent, UniverseSnapshot } from './shared/types.js'
import { UniverseDb } from './db.js'
import { applyReaction, emptyPlanet } from './mappings.js'
import { hashString, pickPersonality, planetName } from './names.js'

const ACTIVE: AgentStatus[] = ['spawning', 'exploring', 'building', 'thinking', 'waiting', 'trouble']
export const isActive = (s: AgentStatus) => ACTIVE.includes(s)

/**
 * The Universe holds every session (planet) and turns normalized events into
 * persistent planet state + status transitions, broadcasting to browsers.
 */
export class Universe {
  sessions = new Map<string, AgentSession>()
  config: UniverseConfig
  missions: MissionRecord[]
  serverStartedAt = Date.now()
  private listeners = new Set<(m: ServerMessage) => void>()
  private seenEventIds: string[] = []
  private seenSet = new Set<string>()
  private lastMissionAt = 0
  private celebratedSinceMission = new Set<string>()
  hooksInstalled = false

  constructor(private db: UniverseDb) {
    for (const s of db.loadSessions()) this.sessions.set(s.id, s)
    this.config = db.loadConfig()
    this.missions = db.loadMissions()
    this.lastMissionAt = this.missions.at(-1)?.completedAt ?? 0
    // sessions that were active when the server last died are unknown now
    for (const s of this.sessions.values()) {
      if (isActive(s.status) && Date.now() - s.lastEventAt > this.config.staleAfterMinutes * 60_000) {
        s.status = 'offline'
        db.saveSession(s)
      }
    }
  }

  subscribe(fn: (m: ServerMessage) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private broadcast(m: ServerMessage) {
    for (const l of this.listeners) {
      try {
        l(m)
      } catch {}
    }
  }

  snapshot(): UniverseSnapshot {
    return {
      sessions: [...this.sessions.values()],
      config: this.config,
      hooksInstalled: this.hooksInstalled,
      serverStartedAt: this.serverStartedAt,
      missions: this.missions,
    }
  }

  setConfig(patch: Partial<UniverseConfig>) {
    this.config = { ...this.config, ...patch }
    this.db.saveConfig(this.config)
    this.broadcast({ kind: 'config', config: this.config })
  }

  reset() {
    this.sessions.clear()
    this.missions = []
    this.celebratedSinceMission.clear()
    this.db.reset()
    this.broadcast({ kind: 'reset' })
  }

  removeSession(id: string) {
    this.sessions.delete(id)
    this.db.deleteSession(id)
    this.broadcast({ kind: 'snapshot', snapshot: this.snapshot() })
  }

  private getOrCreate(id: string, cwd: string | undefined, now: number): AgentSession {
    let s = this.sessions.get(id)
    if (s) {
      if (cwd && !s.cwd) {
        s.cwd = cwd
        s.project = basename(cwd)
      }
      return s
    }
    const seed = hashString(id)
    s = {
      id,
      name: planetName(seed),
      project: cwd ? basename(cwd) : 'unknown',
      cwd: cwd ?? '',
      task: '',
      status: 'spawning',
      seed,
      personality: pickPersonality(seed),
      startedAt: now,
      endedAt: null,
      lastEventAt: now,
      toolCount: 0,
      errorCount: 0,
      turnCount: 0,
      planet: emptyPlanet(),
      recentEvents: [],
    }
    this.sessions.set(id, s)
    this.db.saveSession(s)
    this.broadcast({ kind: 'session', session: s })
    return s
  }

  private isDuplicate(id: string): boolean {
    if (this.seenSet.has(id)) return true
    this.seenSet.add(id)
    this.seenEventIds.push(id)
    if (this.seenEventIds.length > 5000) {
      const old = this.seenEventIds.splice(0, 1000)
      for (const o of old) this.seenSet.delete(o)
    }
    return false
  }

  ingest(events: UniverseEvent[], cwd?: string) {
    for (const e of events) this.applyEvent(e, cwd)
  }

  applyEvent(e: UniverseEvent, cwd?: string) {
    if (this.isDuplicate(e.id)) return
    const now = e.timestamp
    const s = this.getOrCreate(e.sessionId, cwd, now)
    const wasStatus = s.status
    const prevDamage = s.planet.damage
    // reactions on the persistent planet state
    const result = applyReaction(s.planet, e.type, s.personality, this.config.planetDensity, now, s.seed)
    s.planet = result.state
    s.lastEventAt = now
    if (e.type !== 'offline') {
      if (result.built.length) e.metadata = { ...e.metadata, built: result.built }
      if (result.broken) e.metadata = { ...e.metadata, broken: result.broken }
      if (result.repaired || (wasStatus === 'trouble' && e.tone === 'good')) e.metadata = { ...e.metadata, recovered: true }
    }

    // status machine
    switch (e.type) {
      case 'session_started':
        if (s.status === 'completed' || s.status === 'offline' || s.status === 'resting') s.status = 'thinking'
        s.endedAt = null
        break
      case 'prompt':
        if (e.summary) s.task = e.summary
        s.status = 'thinking'
        s.endedAt = null
        break
      case 'file_read':
      case 'search':
      case 'web':
      case 'subagent_started':
      case 'tool_started':
        s.toolCount++
        s.status = s.planet.damage > 0.45 ? 'trouble' : 'exploring'
        break
      case 'file_created':
      case 'file_modified':
      case 'command_started':
      case 'test_started':
      case 'install':
        s.toolCount++
        s.status = s.planet.damage > 0.45 ? 'trouble' : 'building'
        break
      case 'thinking':
        s.status = 'thinking'
        break
      case 'tool_completed':
      case 'command_completed':
      case 'subagent_completed':
        if (isActive(s.status) && s.status !== 'waiting') s.status = s.planet.damage > 0.45 ? 'trouble' : s.status === 'trouble' ? 'building' : s.status
        break
      case 'test_passed':
      case 'commit':
        s.status = 'building'
        break
      case 'command_failed':
      case 'test_failed':
      case 'error':
        s.errorCount++
        s.status = 'trouble'
        break
      case 'waiting':
        s.status = 'waiting'
        break
      case 'turn_completed':
        s.turnCount++
        s.status = 'resting'
        if (s.toolCount > 0) this.celebratedSinceMission.add(s.id)
        break
      case 'session_ended':
        // a session that started and ended without ever doing anything (e.g. an
        // internal helper invocation) is not a world worth remembering
        if (s.toolCount === 0 && !s.task && s.turnCount === 0) {
          this.sessions.delete(s.id)
          this.db.deleteSession(s.id)
          this.broadcast({ kind: 'snapshot', snapshot: this.snapshot() })
          return
        }
        s.status = 'completed'
        s.endedAt = now
        break
      case 'offline':
        s.status = 'offline'
        break
    }
    if (wasStatus === 'trouble' && s.status !== 'trouble' && prevDamage > 0.05) e.metadata = { ...e.metadata, recovered: true }
    if (e.type === 'prompt' && (wasStatus === 'resting' || wasStatus === 'completed' || wasStatus === 'offline')) {
      e.metadata = { ...e.metadata, reawakened: true }
    }

    s.recentEvents = [...s.recentEvents, e].slice(-40)
    this.db.saveEvent(e)
    this.db.saveSession(s)
    this.broadcast({ kind: 'event', event: e, session: s })
    if (e.type === 'turn_completed' || e.type === 'session_ended') this.checkMissionComplete(now)
  }

  /** all worlds that were working have finished → universe-wide celebration */
  private checkMissionComplete(now: number) {
    const active = [...this.sessions.values()].filter((s) => isActive(s.status))
    if (active.length > 0) return
    if (this.celebratedSinceMission.size === 0) return
    if (now - this.lastMissionAt < 90_000) return
    const ids = [...this.celebratedSinceMission]
    // wait a beat so the individual celebration can play first
    setTimeout(() => {
      const stillQuiet = ![...this.sessions.values()].some((s) => isActive(s.status))
      if (!stillQuiet) return
      const mission = this.db.saveMission({ completedAt: Date.now(), sessionIds: ids })
      this.missions.push(mission)
      this.lastMissionAt = mission.completedAt
      this.celebratedSinceMission.clear()
      this.broadcast({ kind: 'mission_complete', mission })
    }, 9000)
  }

  /** periodic: mark silent active sessions as offline */
  sweepStale() {
    const now = Date.now()
    const limit = this.config.staleAfterMinutes * 60_000
    for (const s of this.sessions.values()) {
      if (!isActive(s.status)) continue
      // a world waiting for the human isn't stale as quickly
      const factor = s.status === 'waiting' ? 3 : 1
      if (now - s.lastEventAt > limit * factor) {
        this.applyEvent({ id: `${s.id}:offline:${now}`, sessionId: s.id, timestamp: now, type: 'offline', summary: 'lost contact', tone: 'neutral' })
      }
    }
  }
}
