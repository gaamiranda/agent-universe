import { useEffect, useState } from 'react'
import type { UniverseEvent, AgentStatus } from '@shared/types'
import { api, store, useStore } from '../state/store'

const STATUS_TEXT: Record<AgentStatus, { label: string; color: string }> = {
  spawning: { label: 'forming', color: '#9fe8ff' },
  exploring: { label: 'exploring', color: '#7fd7ff' },
  building: { label: 'building', color: '#ffd86b' },
  thinking: { label: 'thinking', color: '#d9dbe8' },
  waiting: { label: 'needs you', color: '#ffd86b' },
  trouble: { label: 'in trouble', color: '#ff8a8a' },
  resting: { label: 'finished · resting', color: '#b8ffcf' },
  completed: { label: 'completed', color: '#b8ffcf' },
  offline: { label: 'lost contact', color: '#8a8a95' },
}

const GLYPH: Partial<Record<UniverseEvent['type'], string>> = {
  session_started: '✦', prompt: '❝', file_read: '◌', search: '◎', web: '◍', file_created: '▣', file_modified: '▤', command_started: '⚙', command_completed: '✓',
  command_failed: '✗', test_started: '⚗', test_passed: '★', test_failed: '☄', install: '▦', commit: '🚀', subagent_started: '▸', subagent_completed: '◂', error: '⚡',
  waiting: '!', thinking: '…', turn_completed: '✺', session_ended: '∎', offline: '⋯', tool_started: '·', tool_completed: '·',
}

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function FocusPanel({ id }: { id: string }) {
  const session = useStore((s) => s.sessions[id])
  const [events, setEvents] = useState<UniverseEvent[] | null>(null)
  const [showTech, setShowTech] = useState(false)
  useEffect(() => {
    setEvents(null)
    api.events(id).then(setEvents).catch(() => setEvents([]))
  }, [id])
  if (!session) return null
  const st = STATUS_TEXT[session.status]
  const timeline = (events ?? session.recentEvents).filter((e) => e.type !== 'tool_completed' && e.type !== 'tool_started').slice(-60)
  const end = session.endedAt ?? (session.status === 'resting' ? session.lastEventAt : Date.now())
  const p = session.planet
  return (
    <div className="ui panel focus">
      <button className="close" onClick={() => store.focus(null)} aria-label="close">×</button>
      <div className="focus-name">{session.name}</div>
      <div className="focus-task">{session.task || 'awaiting instructions'}</div>
      <div className="focus-status" style={{ color: st.color }}>
        <span className="dot" style={{ background: st.color }} /> {st.label}
      </div>
      <div className="focus-meta">
        <span title={session.cwd}>🌌 {session.project}</span>
        <span>· {session.personality}</span>
        <span>· {fmtDuration(end - session.startedAt)}</span>
      </div>
      <div className="timeline">
        {timeline.map((e) => (
          <span key={e.id} className={`ev ${e.tone ?? 'neutral'}`} title={`${e.type}: ${e.summary ?? ''}`}>
            {GLYPH[e.type] ?? '·'}
          </span>
        ))}
        {timeline.length === 0 && <span className="muted">nothing has happened yet</span>}
      </div>
      <div className="focus-last">{timeline.at(-1)?.summary}</div>
      <div className="focus-world">
        {p.structures.length} structures · {Math.round(p.population)} citizens · {Math.round(p.satellites)} satellites · {p.celebrations} celebrations
      </div>
      <button className="link" onClick={() => setShowTech(!showTech)}>
        {showTech ? 'hide details' : 'details'}
      </button>
      {showTech && (
        <div className="tech">
          <div>session {session.id}</div>
          <div>{session.toolCount} tool calls · {session.errorCount} errors · {session.turnCount} turns</div>
          <div>started {new Date(session.startedAt).toLocaleString()}</div>
          <button className="link danger" onClick={() => { api.deleteSession(session.id); store.focus(null) }}>
            remove this world
          </button>
        </div>
      )}
    </div>
  )
}
