#!/usr/bin/env node
/**
 * Agent Universe hook for Claude Code.
 *
 * Claude Code runs this script (async, in the background) for each hook event,
 * piping the event JSON on stdin. We forward it to the local Agent Universe
 * server. If the server isn't running we exit silently — this must never
 * slow down or break a Claude Code session.
 *
 * Zero dependencies. Configured by `npm run hooks:install`.
 */
import { request } from 'node:http'
import { randomBytes } from 'node:crypto'

const PORT = Number(process.env.AGENT_UNIVERSE_PORT ?? 4242)
const TIMEOUT_MS = 1500

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    process.exit(0)
  }
  if (!payload.hook_event_name && process.argv[2]) payload.hook_event_name = process.argv[2]
  payload._nonce = randomBytes(6).toString('hex')
  payload._sentAt = Date.now()
  // Trim huge tool responses (file contents etc) — the universe only needs the gist.
  if (payload.tool_response && typeof payload.tool_response === 'object') {
    const r = payload.tool_response
    const slim = {}
    for (const k of ['exit_code', 'exitCode', 'interrupted', 'error', 'type']) if (k in r) slim[k] = r[k]
    if (typeof r.stderr === 'string') slim.stderr = r.stderr.slice(0, 500)
    if (typeof r.stdout === 'string') slim.stdout = r.stdout.slice(0, 200)
    payload.tool_response = slim
  } else if (typeof payload.tool_response === 'string') {
    payload.tool_response = { text: payload.tool_response.slice(0, 200) }
  }
  if (payload.tool_input && typeof payload.tool_input === 'object') {
    const i = payload.tool_input
    const slim = {}
    for (const k of ['file_path', 'notebook_path', 'command', 'pattern', 'query', 'url', 'description', 'prompt', 'subagent_type']) {
      if (typeof i[k] === 'string') slim[k] = i[k].slice(0, 400)
    }
    payload.tool_input = slim
  }
  const body = JSON.stringify(payload)
  const req = request(
    { host: '127.0.0.1', port: PORT, path: '/api/hook', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: TIMEOUT_MS },
    (res) => {
      res.resume()
      res.on('end', () => process.exit(0))
    },
  )
  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.on('error', () => process.exit(0))
  req.end(body)
})
process.stdin.resume()
