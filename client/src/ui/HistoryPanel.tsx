import { useEffect, useRef } from 'react'
import type { AgentSession } from '@shared/types'
import { store, useStore } from '../state/store'
import { generateSurface, renderSphere } from '../universe/surface'

const DONE = new Set(['resting', 'completed', 'offline'])

/** a still-life thumbnail of a world, rendered once */
function Thumb({ s }: { s: AgentSession }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const D = 28
    c.width = D
    c.height = D
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(D, D)
    const surf = generateSurface(s.seed, s.planet.vegetation)
    renderSphere(img, surf, D, s.seed % 6, 0, [-0.5, 0.4, 0.75], s.planet.energy, s.planet.damage * 0.5, 0)
    ctx.putImageData(img, 0, 0)
  }, [s.seed])
  return <canvas ref={ref} className="thumb" />
}

function fmtDuration(ms: number) {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function HistoryPanel() {
  const sessions = useStore((s) => s.sessions)
  const missions = useStore((s) => s.missions)
  const list = Object.values(sessions)
    .filter((s) => DONE.has(s.status))
    .sort((a, b) => (b.endedAt ?? b.lastEventAt) - (a.endedAt ?? a.lastEventAt))
  const byDay = new Map<string, AgentSession[]>()
  for (const s of list) {
    const day = new Date(s.endedAt ?? s.lastEventAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    byDay.set(day, [...(byDay.get(day) ?? []), s])
  }
  return (
    <div className="ui panel history">
      <button className="close" onClick={() => store.set({ panel: 'none' })} aria-label="close">×</button>
      <div className="panel-title">MUSEUM OF WORLDS</div>
      <div className="muted">
        {list.length} {list.length === 1 ? 'world' : 'worlds'} at rest · {missions.length} {missions.length === 1 ? 'mission' : 'missions'} complete
      </div>
      {list.length === 0 && <div className="empty">No worlds have finished yet. They will gather here.</div>}
      {[...byDay.entries()].map(([day, items]) => (
        <div key={day} className="day">
          <div className="day-title">{day}</div>
          <div className="worlds">
            {items.map((s) => (
              <button key={s.id} className="world" onClick={() => { store.set({ panel: 'none' }); store.focus(s.id) }} title={s.task}>
                <Thumb s={s} />
                <div className="world-name">{s.name}</div>
                <div className="world-task">{s.task || 'untitled task'}</div>
                <div className="world-meta">
                  {s.project} · {fmtDuration((s.endedAt ?? s.lastEventAt) - s.startedAt)} · {s.planet.structures.length} structures
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
