import { store } from '../state/store'

export function ConnectPanel() {
  return (
    <div className="ui panel connect">
      <button className="close" onClick={() => store.set({ panel: 'none' })} aria-label="close">×</button>
      <div className="panel-title">CONNECT CLAUDE CODE</div>
      <p>
        Claude Code isn't reporting to this universe yet. Install the hooks once and every new Claude Code session on this machine becomes a planet:
      </p>
      <pre>npm run hooks:install</pre>
      <p className="muted">
        This adds a few <code>hooks</code> entries to <code>~/.claude/settings.json</code> (a backup is kept). The hook runs in the background and exits silently if this app isn't running. Remove it with <code>npm run hooks:uninstall</code>.
      </p>
      <p className="muted">Meanwhile, try a mock agent from ⚙ settings → playground.</p>
    </div>
  )
}
