import { useSyncExternalStore } from 'react'
import type { AgentSession, MissionRecord, ServerMessage, UniverseConfig, UniverseEvent } from '@shared/types'
import { DEFAULT_CONFIG } from '@shared/types'

export interface Toast {
  id: number
  text: string
  sub?: string
  kind: 'info' | 'celebrate' | 'trouble'
  at: number
}

export interface StoreState {
  connected: boolean
  sessions: Record<string, AgentSession>
  config: UniverseConfig
  hooksInstalled: boolean
  missions: MissionRecord[]
  focusedId: string | null
  panel: 'none' | 'settings' | 'history' | 'connect'
  toasts: Toast[]
  missionBanner: number | null
}

type Listener = () => void
type EventListener = (e: UniverseEvent, session: AgentSession) => void
type MessageListener = (m: ServerMessage) => void

let state: StoreState = {
  connected: false,
  sessions: {},
  config: { ...DEFAULT_CONFIG },
  hooksInstalled: true,
  missions: [],
  focusedId: null,
  panel: 'none',
  toasts: [],
  missionBanner: null,
}
const listeners = new Set<Listener>()
const eventListeners = new Set<EventListener>()
const messageListeners = new Set<MessageListener>()
let toastId = 0

function emit() {
  for (const l of listeners) l()
}

export const store = {
  get: () => state,
  set(patch: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch
    state = { ...state, ...p }
    emit()
  },
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  onEvent(l: EventListener) {
    eventListeners.add(l)
    return () => eventListeners.delete(l)
  },
  onMessage(l: MessageListener) {
    messageListeners.add(l)
    return () => messageListeners.delete(l)
  },
  toast(text: string, kind: Toast['kind'] = 'info', sub?: string) {
    const t: Toast = { id: ++toastId, text, sub, kind, at: Date.now() }
    store.set((s) => ({ toasts: [...s.toasts.slice(-3), t] }))
    setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), kind === 'celebrate' ? 7000 : 5000)
  },
  focus(id: string | null) {
    store.set({ focusedId: id })
  },
}

export function useStore<T>(selector: (s: StoreState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(state))
}

function handleMessage(m: ServerMessage) {
  switch (m.kind) {
    case 'snapshot': {
      const sessions: Record<string, AgentSession> = {}
      for (const s of m.snapshot.sessions) sessions[s.id] = s
      store.set({ sessions, config: m.snapshot.config, hooksInstalled: m.snapshot.hooksInstalled, missions: m.snapshot.missions })
      break
    }
    case 'session':
      store.set((s) => ({ sessions: { ...s.sessions, [m.session.id]: m.session } }))
      break
    case 'event':
      store.set((s) => ({ sessions: { ...s.sessions, [m.session.id]: m.session } }))
      for (const l of eventListeners) l(m.event, m.session)
      break
    case 'config':
      store.set({ config: m.config })
      break
    case 'mission_complete':
      store.set((s) => ({ missions: [...s.missions, m.mission], missionBanner: Date.now() }))
      setTimeout(() => store.set({ missionBanner: null }), 9000)
      break
    case 'reset':
      store.set({ sessions: {}, missions: [], focusedId: null })
      break
  }
  for (const l of messageListeners) l(m)
}

let es: EventSource | null = null
export function connect() {
  if (es) es.close()
  es = new EventSource('/api/stream')
  es.onopen = () => store.set({ connected: true })
  es.onmessage = (ev) => {
    try {
      handleMessage(JSON.parse(ev.data) as ServerMessage)
    } catch (err) {
      console.warn('bad message', err)
    }
  }
  es.onerror = () => {
    store.set({ connected: false })
    // EventSource auto-reconnects; the server re-sends a snapshot on connect.
  }
}

export const api = {
  async updateConfig(patch: Partial<UniverseConfig>) {
    store.set((s) => ({ config: { ...s.config, ...patch } }))
    await fetch('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  },
  reset: () => fetch('/api/reset', { method: 'POST' }),
  mock: (opts: Record<string, unknown> = {}) => fetch('/api/mock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts) }),
  mockFinish: () => fetch('/api/mock/finish', { method: 'POST' }),
  mockError: () => fetch('/api/mock/error', { method: 'POST' }),
  deleteSession: (id: string) => fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  events: (id: string) => fetch(`/api/sessions/${encodeURIComponent(id)}/events`).then((r) => r.json() as Promise<UniverseEvent[]>),
}
