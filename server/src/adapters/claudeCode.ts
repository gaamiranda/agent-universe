/**
 * Claude Code adapter: turns raw hook payloads (delivered by
 * hooks/agent-universe-hook.mjs) into normalized UniverseEvents.
 *
 * Hook reference: https://code.claude.com/docs/en/hooks
 * Hooks used: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
 * PostToolUseFailure, Notification, Stop, SubagentStart, SubagentStop, SessionEnd.
 */
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { UniverseEvent, UniverseEventType } from '../shared/types.js'

export interface HookPayload {
  hook_event_name: string
  session_id: string
  cwd?: string
  transcript_path?: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
  tool_name?: string
  tool_input?: Record<string, any>
  tool_response?: any
  tool_use_id?: string
  prompt?: string
  source?: string
  reason?: string
  message?: string
  notification_type?: string
  stop_hook_active?: boolean
  error?: string
  /** added by the hook script */
  _nonce?: string
  [k: string]: unknown
}

export interface AdaptedHook {
  events: UniverseEvent[]
  cwd?: string
}

const TEST_RE = /\b(vitest|jest|pytest|mocha|playwright|cypress|rspec|phpunit|go test|cargo test|dotnet test|mix test|npm test|pnpm test|yarn test|bun test|make test|tox|ctest|swift test|xcodebuild test)\b/i
const INSTALL_RE = /\b(npm (i|install|ci|add)|pnpm (i|install|add)|yarn( add| install)?$|yarn (add|install)|bun (i|install|add)|pip3? install|poetry (add|install)|cargo add|go get|go mod (download|tidy)|brew install|apt(-get)? install|gem install|bundle install|composer (install|require)|uv (add|sync|pip install))\b/i
const COMMIT_RE = /\bgit\s+(-\S+\s+)*commit\b/
const PUSH_RE = /\bgit\s+push\b/

function shortPath(p: unknown): string {
  if (typeof p !== 'string' || !p) return ''
  return basename(p)
}

function shortCmd(c: unknown): string {
  if (typeof c !== 'string') return ''
  const first = c.trim().split('\n')[0]
  return first.length > 60 ? first.slice(0, 57) + '…' : first
}

function classifyTool(name: string, input: Record<string, any> = {}): { type: UniverseEventType; summary: string; meta: Record<string, unknown> } {
  const n = name.toLowerCase()
  if (n === 'read' || n === 'notebookread') return { type: 'file_read', summary: `read ${shortPath(input.file_path ?? input.notebook_path)}`, meta: { path: input.file_path } }
  if (n === 'grep' || n === 'glob' || n === 'ls' || n === 'toolsearch') return { type: 'search', summary: `searched ${input.pattern ?? input.query ?? ''}`.trim(), meta: { pattern: input.pattern ?? input.query } }
  if (n === 'edit' || n === 'multiedit' || n === 'notebookedit') return { type: 'file_modified', summary: `edited ${shortPath(input.file_path ?? input.notebook_path)}`, meta: { path: input.file_path } }
  if (n === 'write') {
    // Hooks run async, so by the time we look the file may already exist.
    // The real answer comes from the tool_response at PostToolUse (see below);
    // at PreToolUse we just report generic construction activity.
    const path = input.file_path as string | undefined
    return { type: 'tool_started', summary: `writing ${shortPath(path)}`, meta: { path, write: true } }
  }
  if (n === 'bash' || n === 'powershell') {
    const cmd = String(input.command ?? '')
    if (TEST_RE.test(cmd)) return { type: 'test_started', summary: `testing: ${shortCmd(cmd)}`, meta: { command: cmd, kind: 'test' } }
    if (INSTALL_RE.test(cmd)) return { type: 'install', summary: `installing: ${shortCmd(cmd)}`, meta: { command: cmd, kind: 'install' } }
    if (COMMIT_RE.test(cmd)) return { type: 'command_started', summary: `committing: ${shortCmd(cmd)}`, meta: { command: cmd, kind: 'commit' } }
    if (PUSH_RE.test(cmd)) return { type: 'command_started', summary: `pushing: ${shortCmd(cmd)}`, meta: { command: cmd, kind: 'push' } }
    return { type: 'command_started', summary: `ran ${shortCmd(cmd)}`, meta: { command: cmd, kind: 'shell' } }
  }
  if (n === 'agent' || n === 'task') return { type: 'subagent_started', summary: `sent out a scout: ${String(input.description ?? '').slice(0, 40)}`, meta: { description: input.description } }
  if (n === 'webfetch' || n === 'websearch' || n.includes('fetch') || n.includes('search')) return { type: 'web', summary: `looked up ${String(input.url ?? input.query ?? '').slice(0, 40)}`, meta: { url: input.url ?? input.query } }
  if (n === 'todowrite' || n === 'taskcreate' || n === 'taskupdate' || n === 'exitplanmode' || n === 'enterplanmode') return { type: 'thinking', summary: 'making plans', meta: {} }
  return { type: 'tool_started', summary: `used ${name}`, meta: { tool: name } }
}

function safeExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

function eventId(p: HookPayload, suffix?: string): string {
  const key = p.tool_use_id ?? p._nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `${p.session_id}:${p.hook_event_name}:${key}${suffix ? ':' + suffix : ''}`
}

export function adaptClaudeCodeHook(p: HookPayload, now = Date.now()): AdaptedHook {
  const sessionId = p.session_id
  const base = (type: UniverseEventType, summary: string, tone: UniverseEvent['tone'], meta: Record<string, unknown> = {}, suffix?: string): UniverseEvent => ({
    id: eventId(p, suffix),
    sessionId,
    timestamp: now,
    type,
    summary,
    tone,
    metadata: { ...meta, hook: p.hook_event_name, ...(p.agent_id ? { agentId: p.agent_id, agentType: p.agent_type } : {}) },
  })
  const events: UniverseEvent[] = []
  const toolName = p.tool_name ?? ''
  const input = p.tool_input ?? {}

  switch (p.hook_event_name) {
    case 'SessionStart': {
      events.push(base('session_started', p.source === 'resume' ? 'session resumed' : 'a new world begins', 'good', { source: p.source }))
      break
    }
    case 'UserPromptSubmit': {
      const prompt = String(p.prompt ?? '').trim()
      if (prompt.startsWith('/') && prompt.length < 40) break // slash commands are not tasks
      events.push(base('prompt', prompt.slice(0, 200), 'neutral', { prompt: prompt.slice(0, 2000) }))
      break
    }
    case 'PreToolUse': {
      const c = classifyTool(toolName, input)
      events.push(base(c.type, c.summary, 'neutral', { ...c.meta, tool: toolName, phase: 'start' }))
      break
    }
    case 'PostToolUse': {
      const c = classifyTool(toolName, input)
      const resp = p.tool_response ?? {}
      if (c.meta.write) {
        const path = input.file_path as string | undefined
        const kind = typeof resp?.type === 'string' ? resp.type : undefined
        const created = kind ? kind === 'create' : !(path && safeExists(path))
        events.push(created
          ? base('file_created', `created ${shortPath(path)}`, 'neutral', { path, tool: toolName })
          : base('file_modified', `rewrote ${shortPath(path)}`, 'neutral', { path, tool: toolName }))
        break
      }
      const exit = typeof resp?.exit_code === 'number' ? resp.exit_code : typeof resp?.exitCode === 'number' ? resp.exitCode : undefined
      const interrupted = resp?.interrupted === true
      const failed = (exit !== undefined && exit !== 0) || interrupted
      if (c.type === 'test_started') {
        events.push(failed ? base('test_failed', 'tests failed', 'bad', c.meta) : base('test_passed', 'tests passed', 'good', c.meta))
      } else if (c.type === 'command_started' || c.type === 'install') {
        if (failed) events.push(base('command_failed', `failed: ${shortCmd(input.command)}`, 'bad', { ...c.meta, exit }))
        else if (c.meta.kind === 'commit') events.push(base('commit', 'committed a milestone', 'good', c.meta))
        else if (c.meta.kind === 'push') events.push(base('commit', 'pushed to the stars', 'good', { ...c.meta, push: true }))
        else events.push(base('command_completed', `finished ${shortCmd(input.command)}`, 'good', c.meta))
      } else if (c.type === 'subagent_started') {
        events.push(base('subagent_completed', 'scout returned', 'good', c.meta))
      } else {
        events.push(base('tool_completed', c.summary, 'neutral', { ...c.meta, tool: toolName }))
      }
      break
    }
    case 'PostToolUseFailure': {
      const c = classifyTool(toolName, input)
      const err = String(p.error ?? p.tool_response?.error ?? p.tool_response?.stderr ?? '').slice(0, 200)
      if (c.type === 'test_started') events.push(base('test_failed', 'tests failed', 'bad', { ...c.meta, error: err }))
      else if (c.type === 'command_started' || c.type === 'install') events.push(base('command_failed', `failed: ${shortCmd(input.command)}`, 'bad', { ...c.meta, error: err }))
      else events.push(base('error', `${toolName} failed${err ? ': ' + err.slice(0, 60) : ''}`, 'bad', { ...c.meta, tool: toolName, error: err }))
      break
    }
    case 'Notification': {
      const msg = String(p.message ?? '')
      const kind = String(p.notification_type ?? '')
      const needsHuman = /permission|waiting|input|idle/i.test(kind + ' ' + msg)
      if (needsHuman) events.push(base('waiting', msg.slice(0, 120) || 'needs your attention', 'neutral', { notificationType: kind }))
      break
    }
    case 'SubagentStart': {
      events.push(base('subagent_started', `scout launched (${p.agent_type ?? 'agent'})`, 'neutral', { agentType: p.agent_type }))
      break
    }
    case 'SubagentStop': {
      events.push(base('subagent_completed', 'scout returned', 'good', { agentType: p.agent_type }))
      break
    }
    case 'Stop': {
      // Stop fires when the agent finished responding — the task it was given is done.
      // Don't celebrate if a Stop hook is forcing continuation.
      if (p.stop_hook_active) break
      events.push(base('turn_completed', 'finished its task', 'good'))
      break
    }
    case 'SessionEnd': {
      events.push(base('session_ended', `session closed (${p.reason ?? 'exit'})`, 'neutral', { reason: p.reason }))
      break
    }
    default:
      break
  }
  return { events, cwd: p.cwd }
}
