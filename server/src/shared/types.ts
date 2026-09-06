/**
 * Shared, normalized model for Agent Universe.
 *
 * Claude Code hook payloads are translated into UniverseEvents on the server
 * (see server/src/adapters/claudeCode.ts). Everything downstream of that —
 * the planet state machine, persistence, the renderer, the audio — only ever
 * sees this normalized model, so other agent runtimes can be adapted later.
 */

export type UniverseEventType =
  | 'session_started'
  | 'prompt'            // user gave the agent a task / new instruction
  | 'thinking'          // agent is between tools (derived)
  | 'tool_started'
  | 'tool_completed'
  | 'file_read'
  | 'search'
  | 'file_created'
  | 'file_modified'
  | 'command_started'
  | 'command_completed'
  | 'command_failed'
  | 'test_started'
  | 'test_passed'
  | 'test_failed'
  | 'install'
  | 'commit'
  | 'web'
  | 'subagent_started'
  | 'subagent_completed'
  | 'error'
  | 'waiting'           // needs the human (permission / idle notification)
  | 'turn_completed'    // agent finished the task it was given (Stop hook)
  | 'session_ended'
  | 'offline'           // derived: no signal for a long time

export interface UniverseEvent {
  id: string
  sessionId: string
  timestamp: number
  type: UniverseEventType
  /** short human summary, e.g. "edited src/app.ts" */
  summary?: string
  /** whether this event is a good sign, a bad sign, or neutral */
  tone?: 'good' | 'bad' | 'neutral'
  metadata?: Record<string, unknown>
}

export type AgentStatus =
  | 'spawning'
  | 'exploring'
  | 'building'
  | 'thinking'
  | 'waiting'
  | 'trouble'
  | 'resting'    // turn finished; planet celebrated and now rests in the completed ring
  | 'completed'  // session closed for good
  | 'offline'

export type Personality =
  | 'chaotic'
  | 'industrious'
  | 'sleepy'
  | 'exploratory'
  | 'overconfident'
  | 'mysterious'
  | 'tiny'

export type StructureKind =
  | 'hut'
  | 'tower'
  | 'dome'
  | 'factory'
  | 'antenna'
  | 'lab'
  | 'monument'
  | 'tree'
  | 'crystal'
  | 'beacon'

export interface Structure {
  id: string
  kind: StructureKind
  /** latitude in radians (-pi/2..pi/2) */
  lat: number
  /** longitude in radians (0..2pi) */
  lon: number
  /** when it appeared, for build-up animation */
  bornAt: number
  /** 0 = intact, 1 = broken */
  damaged: number
}

export interface PlanetState {
  energy: number       // 0..1 how lit / powered the civilization is
  activity: number     // 0..1 short-lived bustle, decays over time
  vegetation: number   // 0..1
  population: number   // raw count, drives tiny creatures
  satellites: number   // orbiting satellites
  discoveries: number  // milestones (commits etc.) → monuments/beacons
  damage: number       // 0..1 decays as recoveries happen
  celebrations: number // how many times this world has partied
  structures: Structure[]
}

export interface AgentSession {
  id: string
  name: string
  project: string
  cwd: string
  task: string
  status: AgentStatus
  seed: number
  personality: Personality
  startedAt: number
  endedAt: number | null
  lastEventAt: number
  toolCount: number
  errorCount: number
  turnCount: number
  planet: PlanetState
  /** the last few events, newest last */
  recentEvents: UniverseEvent[]
}

export interface UniverseConfig {
  soundEnabled: boolean
  volume: number           // 0..1
  animationIntensity: number // 0..1
  planetDensity: number    // 0..1 how much stuff planets grow
  maxActivePlanets: number
  visualQuality: 'low' | 'medium' | 'high'
  completionEffects: boolean
  showLabels: boolean
  staleAfterMinutes: number
}

export const DEFAULT_CONFIG: UniverseConfig = {
  soundEnabled: true,
  volume: 0.5,
  animationIntensity: 1,
  planetDensity: 1,
  maxActivePlanets: 12,
  visualQuality: 'high',
  completionEffects: true,
  showLabels: true,
  staleAfterMinutes: 12,
}

export interface UniverseSnapshot {
  sessions: AgentSession[]
  config: UniverseConfig
  hooksInstalled: boolean
  serverStartedAt: number
  missions: MissionRecord[]
}

export interface MissionRecord {
  id: number
  completedAt: number
  sessionIds: string[]
}

/** Messages the server pushes to browsers over SSE. */
export type ServerMessage =
  | { kind: 'snapshot'; snapshot: UniverseSnapshot }
  | { kind: 'event'; event: UniverseEvent; session: AgentSession }
  | { kind: 'session'; session: AgentSession }
  | { kind: 'mission_complete'; mission: MissionRecord }
  | { kind: 'config'; config: UniverseConfig }
  | { kind: 'reset' }
