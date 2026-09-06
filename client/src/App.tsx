import { useEffect, useRef } from 'react'
import { Scene } from './universe/scene'
import { store, useStore } from './state/store'
import { setSoundEnabled, setVolume, unlockAudio } from './audio/sound'
import { Hud } from './ui/Hud'
import { FocusPanel } from './ui/FocusPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { HistoryPanel } from './ui/HistoryPanel'
import { ConnectPanel } from './ui/ConnectPanel'
import { Toasts } from './ui/Toasts'

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const config = useStore((s) => s.config)
  const panel = useStore((s) => s.panel)
  const focusedId = useStore((s) => s.focusedId)

  useEffect(() => {
    const scene = new Scene(canvasRef.current!, overlayRef.current!, store.get().config, {
      onFocus: (id) => store.focus(id),
      onHover: () => {},
      onToast: (text, kind, sub) => store.toast(text, kind, sub),
    })
    sceneRef.current = scene
    ;(window as any).__scene = scene
    scene.syncSessions(store.get().sessions, Date.now())
    scene.start()
    const unsubStore = store.subscribe(() => {
      const s = store.get()
      scene.syncSessions(s.sessions, Date.now())
      scene.setConfig(s.config)
      if (scene.focused !== s.focusedId) scene.focused = s.focusedId
    })
    const unsubEvent = store.onEvent((e, session) => scene.handleEvent(e, session, Date.now()))
    const unsubMsg = store.onMessage((m) => {
      if (m.kind === 'mission_complete') scene.missionComplete()
      if (m.kind === 'reset') scene.planets.clear()
    })
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        store.set({ panel: 'none' })
        store.focus(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unsubStore()
      unsubEvent()
      unsubMsg()
      window.removeEventListener('keydown', onKey)
      scene.destroy()
    }
  }, [])

  useEffect(() => {
    setSoundEnabled(config.soundEnabled)
    setVolume(config.volume)
  }, [config.soundEnabled, config.volume])

  return (
    <>
      <canvas ref={canvasRef} className="pixel-canvas" />
      <canvas ref={overlayRef} className="overlay-canvas" />
      <Hud />
      {focusedId && <FocusPanel id={focusedId} />}
      {panel === 'settings' && <SettingsPanel />}
      {panel === 'history' && <HistoryPanel />}
      {panel === 'connect' && <ConnectPanel />}
      <Toasts />
    </>
  )
}
