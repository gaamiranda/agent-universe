import { useState } from 'react'
import { api, store, useStore } from '../state/store'

export function SettingsPanel() {
  const c = useStore((s) => s.config)
  const [confirm, setConfirm] = useState(false)
  const set = (patch: Parameters<typeof api.updateConfig>[0]) => api.updateConfig(patch)
  return (
    <div className="ui panel settings">
      <button className="close" onClick={() => store.set({ panel: 'none' })} aria-label="close">×</button>
      <div className="panel-title">SETTINGS</div>
      <label className="row">
        <span>sound</span>
        <input type="checkbox" checked={c.soundEnabled} onChange={(e) => set({ soundEnabled: e.target.checked })} />
      </label>
      <label className="row">
        <span>volume</span>
        <input type="range" min={0} max={1} step={0.05} value={c.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
      </label>
      <label className="row">
        <span>animation</span>
        <input type="range" min={0} max={1.5} step={0.1} value={c.animationIntensity} onChange={(e) => set({ animationIntensity: Number(e.target.value) })} />
      </label>
      <label className="row">
        <span>planet density</span>
        <input type="range" min={0.3} max={1.5} step={0.1} value={c.planetDensity} onChange={(e) => set({ planetDensity: Number(e.target.value) })} />
      </label>
      <label className="row">
        <span>visual quality</span>
        <select value={c.visualQuality} onChange={(e) => set({ visualQuality: e.target.value as typeof c.visualQuality })}>
          <option value="high">high · fine pixels</option>
          <option value="medium">medium</option>
          <option value="low">low · chunky, cheap</option>
        </select>
      </label>
      <label className="row">
        <span>labels</span>
        <input type="checkbox" checked={c.showLabels} onChange={(e) => set({ showLabels: e.target.checked })} />
      </label>
      <label className="row">
        <span>completion effects</span>
        <input type="checkbox" checked={c.completionEffects} onChange={(e) => set({ completionEffects: e.target.checked })} />
      </label>
      <label className="row">
        <span>lost contact after</span>
        <select value={c.staleAfterMinutes} onChange={(e) => set({ staleAfterMinutes: Number(e.target.value) })}>
          {[5, 12, 30, 60].map((m) => (
            <option key={m} value={m}>{m} min</option>
          ))}
        </select>
      </label>
      <div className="panel-title small">PLAYGROUND</div>
      <div className="row buttons">
        <button className="pill" onClick={() => api.mock({ speed: 1.6 })}>launch a mock agent</button>
        <button className="pill" onClick={() => api.mockError()}>cause trouble</button>
        <button className="pill" onClick={() => api.mockFinish()}>finish mocks</button>
      </div>
      <div className="panel-title small">DANGER</div>
      {!confirm ? (
        <button className="pill danger" onClick={() => setConfirm(true)}>reset the universe…</button>
      ) : (
        <div className="row buttons">
          <button className="pill danger" onClick={() => { api.reset(); setConfirm(false) }}>yes, return every world to stardust</button>
          <button className="pill" onClick={() => setConfirm(false)}>keep them</button>
        </div>
      )}
      <div className="hint">events → planet mappings live in <code>server/src/mappings.ts</code> and <code>client/src/universe/reactions.ts</code></div>
    </div>
  )
}
