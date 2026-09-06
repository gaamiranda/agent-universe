import { useStore } from '../state/store'
import { useStore as _u } from '../state/store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const banner = _u((s) => s.missionBanner)
  return (
    <div className="ui toasts">
      {banner && <div className="toast celebrate big">✦ every world is at rest ✦</div>}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <div>{t.kind === 'celebrate' ? '✺ ' : ''}{t.text}</div>
          {t.sub && <div className="toast-sub">{t.sub}</div>}
        </div>
      ))}
    </div>
  )
}
