import { api, store, useStore } from '../state/store'

const ACTIVE = new Set(['spawning', 'exploring', 'building', 'thinking', 'waiting', 'trouble'])

export function Hud() {
  const sessions = useStore((s) => s.sessions)
  const connected = useStore((s) => s.connected)
  const hooksInstalled = useStore((s) => s.hooksInstalled)
  const panel = useStore((s) => s.panel)
  const config = useStore((s) => s.config)
  const list = Object.values(sessions)
  const active = list.filter((s) => ACTIVE.has(s.status)).length
  const done = list.length - active
  const toggle = (p: typeof panel) => store.set({ panel: panel === p ? 'none' : p, focusedId: null })

  return (
    <div className="ui hud">
      <div className="hud-title">
        <span className="star">✦</span> AGENT UNIVERSE
        <div className="hud-sub">
          {!connected ? (
            <span className="warn">● lost contact with the server</span>
          ) : list.length === 0 ? (
            <span>a quiet universe · waiting for the first world</span>
          ) : (
            <span>
              {active} {active === 1 ? 'world' : 'worlds'} working · {done} at rest
            </span>
          )}
        </div>
      </div>
      <div className="hud-actions">
        {!hooksInstalled && (
          <button className={`pill accent ${panel === 'connect' ? 'on' : ''}`} onClick={() => toggle('connect')} title="Claude Code is not connected yet">
            ⚡ connect claude code
          </button>
        )}
        <button className={`pill ${panel === 'history' ? 'on' : ''}`} onClick={() => toggle('history')} title="Universe history">
          ◐ museum
        </button>
        <button className="pill" onClick={() => api.updateConfig({ soundEnabled: !config.soundEnabled })} title="Toggle sound">
          {config.soundEnabled ? '♪ sound on' : '♪ muted'}
        </button>
        <button className={`pill ${panel === 'settings' ? 'on' : ''}`} onClick={() => toggle('settings')} title="Settings">
          ⚙
        </button>
      </div>
    </div>
  )
}
