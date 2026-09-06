import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentSession, UniverseEvent, UniverseConfig, MissionRecord } from './shared/types.js'
import { DEFAULT_CONFIG } from './shared/types.js'

/**
 * Local SQLite persistence (Node's built-in sqlite, no native build step).
 * Everything lives in one file: data/universe.db
 */
export class UniverseDb {
  private db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id, ts);
      CREATE TABLE IF NOT EXISTS missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        completed_at INTEGER NOT NULL,
        session_ids TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  loadSessions(): AgentSession[] {
    const rows = this.db.prepare('SELECT json FROM sessions ORDER BY started_at ASC').all() as { json: string }[]
    return rows.map((r) => JSON.parse(r.json) as AgentSession)
  }

  saveSession(s: AgentSession) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, json, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, ended_at = excluded.ended_at, status = excluded.status`,
      )
      .run(s.id, JSON.stringify(s), s.startedAt, s.endedAt, s.status)
  }

  /** returns false if the event id already exists (duplicate delivery) */
  saveEvent(e: UniverseEvent): boolean {
    try {
      this.db
        .prepare('INSERT INTO events (id, session_id, ts, type, json) VALUES (?, ?, ?, ?, ?)')
        .run(e.id, e.sessionId, e.timestamp, e.type, JSON.stringify(e))
      return true
    } catch (err: any) {
      if (String(err?.message ?? err).includes('UNIQUE')) return false
      throw err
    }
  }

  loadEvents(sessionId: string, limit = 200): UniverseEvent[] {
    const rows = this.db
      .prepare('SELECT json FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?')
      .all(sessionId, limit) as { json: string }[]
    return rows.map((r) => JSON.parse(r.json) as UniverseEvent).reverse()
  }

  saveMission(m: Omit<MissionRecord, 'id'>): MissionRecord {
    const res = this.db
      .prepare('INSERT INTO missions (completed_at, session_ids) VALUES (?, ?)')
      .run(m.completedAt, JSON.stringify(m.sessionIds))
    return { id: Number(res.lastInsertRowid), ...m }
  }

  loadMissions(): MissionRecord[] {
    const rows = this.db.prepare('SELECT id, completed_at, session_ids FROM missions ORDER BY id ASC').all() as {
      id: number
      completed_at: number
      session_ids: string
    }[]
    return rows.map((r) => ({ id: r.id, completedAt: r.completed_at, sessionIds: JSON.parse(r.session_ids) }))
  }

  loadConfig(): UniverseConfig {
    const row = this.db.prepare("SELECT value FROM config WHERE key = 'config'").get() as { value: string } | undefined
    if (!row) return { ...DEFAULT_CONFIG }
    return { ...DEFAULT_CONFIG, ...(JSON.parse(row.value) as Partial<UniverseConfig>) }
  }

  saveConfig(c: UniverseConfig) {
    this.db
      .prepare("INSERT INTO config (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(c))
  }

  reset() {
    this.db.exec('DELETE FROM sessions; DELETE FROM events; DELETE FROM missions;')
  }

  deleteSession(id: string) {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(id)
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }
}
