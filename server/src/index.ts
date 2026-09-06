import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { UniverseDb } from './db.js'
import { Universe } from './universe.js'
import { adaptClaudeCodeHook, type HookPayload } from './adapters/claudeCode.js'
import { MockAgent } from './mock.js'
import type { ServerMessage } from './shared/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..', '..')
const PORT = Number(process.env.AGENT_UNIVERSE_PORT ?? 4242)
const DATA_PATH = process.env.AGENT_UNIVERSE_DB ?? join(ROOT, 'data', 'universe.db')
const PUBLIC_DIR = join(ROOT, 'server', 'public')

const db = new UniverseDb(DATA_PATH)
const universe = new Universe(db)
const mocks = new Map<string, MockAgent>()

function checkHooksInstalled(): boolean {
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'))
    const hooks = settings?.hooks ?? {}
    return JSON.stringify(hooks).includes('agent-universe-hook')
  } catch {
    return false
  }
}
universe.hooksInstalled = checkHooksInstalled()
setInterval(() => (universe.hooksInstalled = checkHooksInstalled()), 15_000)
setInterval(() => universe.sweepStale(), 30_000)

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const sseClients = new Set<ServerResponse>()
universe.subscribe((m: ServerMessage) => {
  const line = `data: ${JSON.stringify(m)}\n\n`
  for (const c of sseClients) c.write(line)
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,PUT,DELETE' })
      return res.end()
    }
    // ---- Claude Code hooks land here -------------------------------------
    if (path === '/api/hook' && req.method === 'POST') {
      const body = await readBody(req)
      let payload: HookPayload
      try {
        payload = JSON.parse(body)
      } catch {
        return json(res, 400, { ok: false, error: 'invalid json' })
      }
      if (!payload?.session_id || !payload?.hook_event_name) return json(res, 400, { ok: false, error: 'missing session_id / hook_event_name' })
      if (process.env.AGENT_UNIVERSE_LOG_HOOKS) appendFileSync(join(ROOT, 'data', 'hooks.log'), body + '\n')
      const adapted = adaptClaudeCodeHook(payload)
      universe.ingest(adapted.events, adapted.cwd)
      return json(res, 200, { ok: true, events: adapted.events.length })
    }
    // ---- generic normalized events (other runtimes can post these directly) --
    if (path === '/api/events' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req))
      const events = Array.isArray(body) ? body : [body]
      universe.ingest(events, undefined)
      return json(res, 200, { ok: true })
    }
    if (path === '/api/state' && req.method === 'GET') return json(res, 200, universe.snapshot())
    if (path === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' })
      res.write(`data: ${JSON.stringify({ kind: 'snapshot', snapshot: universe.snapshot() } satisfies ServerMessage)}\n\n`)
      sseClients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        sseClients.delete(res)
      })
      return
    }
    if (path === '/api/config' && req.method === 'PUT') {
      universe.setConfig(JSON.parse(await readBody(req)))
      return json(res, 200, universe.config)
    }
    if (path === '/api/reset' && req.method === 'POST') {
      for (const m of mocks.values()) m.stop()
      mocks.clear()
      universe.reset()
      return json(res, 200, { ok: true })
    }
    if (path.startsWith('/api/sessions/') && req.method === 'DELETE') {
      universe.removeSession(decodeURIComponent(path.slice('/api/sessions/'.length)))
      return json(res, 200, { ok: true })
    }
    if (path.startsWith('/api/sessions/') && path.endsWith('/events') && req.method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/sessions/'.length, -'/events'.length))
      return json(res, 200, db.loadEvents(id, 300))
    }
    // ---- mock agents for trying the universe without Claude Code -------------
    if (path === '/api/mock' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const mock = new MockAgent(universe, body)
      mocks.set(mock.id, mock)
      mock.start().finally(() => mocks.delete(mock.id))
      return json(res, 200, { ok: true, id: mock.id })
    }
    if (path === '/api/mock/finish' && req.method === 'POST') {
      for (const m of mocks.values()) m.finishSoon()
      return json(res, 200, { ok: true })
    }
    if (path === '/api/mock/error' && req.method === 'POST') {
      for (const m of mocks.values()) m.injectError()
      return json(res, 200, { ok: true })
    }
    if (path === '/api/health') return json(res, 200, { ok: true, uptime: process.uptime() })

    // ---- static (production build) ----------------------------------------
    if (existsSync(PUBLIC_DIR)) {
      let file = join(PUBLIC_DIR, path === '/' ? 'index.html' : path)
      if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'nope' })
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(PUBLIC_DIR, 'index.html')
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      return res.end(readFileSync(file))
    }
    json(res, 404, { error: 'not found (run `npm run dev` for the UI at http://localhost:4243)' })
  } catch (err: any) {
    console.error(err)
    json(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✦ Agent Universe server listening on http://127.0.0.1:${PORT}`)
  console.log(`  data: ${DATA_PATH}`)
  console.log(`  hooks installed: ${universe.hooksInstalled ? 'yes' : 'no (run: npm run hooks:install)'}`)
  if (existsSync(PUBLIC_DIR)) console.log(`  ui:   http://127.0.0.1:${PORT}`)
})
