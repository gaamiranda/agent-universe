/**
 * A pretend Claude Code session, used for demos/testing without real agents.
 * It emits real hook-shaped payloads through the same adapter path.
 */
import { adaptClaudeCodeHook } from './adapters/claudeCode.js'
import type { Universe } from './universe.js'
import { mulberry32 } from './names.js'

const TASKS = [
  'Build the authentication system',
  'Refactor the billing module',
  'Research the weather API',
  'Fix flaky integration tests',
  'Add dark mode to the settings page',
  'Migrate the database to Postgres',
  'Write docs for the plugin system',
  'Speed up the search index',
]
const FILES = ['src/auth/login.ts', 'src/app.tsx', 'lib/api.ts', 'README.md', 'src/db/schema.sql', 'tests/auth.test.ts', 'src/components/Nav.tsx', 'package.json', 'src/utils/time.ts']
const CMDS = ['npm run build', 'npm test', 'git status', 'ls -la src', 'npm install zod', 'node scripts/check.mjs', 'npx tsc --noEmit', 'git commit -m "wip"', 'npm test', 'cat package.json']

export class MockAgent {
  id: string
  private stopped = false
  private finishing = false
  private errorQueued = false
  private rng: () => number
  private speed: number
  private cwd: string
  private task: string
  private turns: number

  constructor(private universe: Universe, opts: { speed?: number; project?: string; task?: string; turns?: number } = {}) {
    this.id = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.rng = mulberry32(Date.now() & 0xffffffff)
    this.speed = opts.speed ?? 1
    this.cwd = `/Users/you/projects/${opts.project ?? ['my-app', 'api', 'website', 'toolbox'][Math.floor(this.rng() * 4)]}`
    this.task = opts.task ?? TASKS[Math.floor(this.rng() * TASKS.length)]
    this.turns = opts.turns ?? 1
  }

  private send(payload: Record<string, unknown>) {
    if (this.stopped) return
    const adapted = adaptClaudeCodeHook({ session_id: this.id, cwd: this.cwd, _nonce: Math.random().toString(36).slice(2), ...payload } as any)
    this.universe.ingest(adapted.events, adapted.cwd)
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms / this.speed))
  }

  stop() {
    this.stopped = true
  }
  finishSoon() {
    this.finishing = true
  }
  injectError() {
    this.errorQueued = true
  }

  async start() {
    this.send({ hook_event_name: 'SessionStart', source: 'startup' })
    await this.sleep(1500)
    for (let turn = 0; turn < this.turns && !this.stopped; turn++) {
      this.send({ hook_event_name: 'UserPromptSubmit', prompt: turn === 0 ? this.task : 'Now also ' + TASKS[Math.floor(this.rng() * TASKS.length)].toLowerCase() })
      await this.sleep(2000)
      const steps = 18 + Math.floor(this.rng() * 16)
      for (let i = 0; i < steps && !this.stopped; i++) {
        if (this.finishing && i > 3) break
        await this.step(i)
        await this.sleep(900 + this.rng() * 2400)
      }
      this.send({ hook_event_name: 'Stop', stop_hook_active: false })
      await this.sleep(6000)
    }
    if (!this.stopped) this.send({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' })
  }

  private async step(i: number) {
    const id = `tu-${i}-${Math.random().toString(36).slice(2, 7)}`
    const r = this.rng()
    let tool: string
    let input: Record<string, unknown>
    if (this.errorQueued) {
      this.errorQueued = false
      tool = 'Bash'
      input = { command: 'npm test' }
      this.send({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: id })
      await this.sleep(1200)
      this.send({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_use_id: id, tool_response: { stdout: '', stderr: '3 tests failed', exit_code: 1 } })
      return
    }
    if (i < 4 || r < 0.3) {
      tool = r < 0.5 ? 'Read' : r < 0.8 ? 'Grep' : 'Glob'
      input = tool === 'Read' ? { file_path: `${this.cwd}/${FILES[Math.floor(this.rng() * FILES.length)]}` } : { pattern: ['useAuth', 'TODO', '*.ts', 'export default'][Math.floor(this.rng() * 4)] }
    } else if (r < 0.62) {
      tool = this.rng() < 0.3 ? 'Write' : 'Edit'
      input = { file_path: `${this.cwd}/${FILES[Math.floor(this.rng() * FILES.length)]}` }
    } else if (r < 0.92) {
      tool = 'Bash'
      input = { command: CMDS[Math.floor(this.rng() * CMDS.length)] }
    } else {
      tool = 'Agent'
      input = { description: 'explore the codebase' }
    }
    this.send({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: id })
    await this.sleep(tool === 'Bash' ? 1500 + this.rng() * 2500 : tool === 'Agent' ? 5000 : 400 + this.rng() * 800)
    if (tool === 'Bash') {
      const fail = this.rng() < 0.14
      this.send({ hook_event_name: fail ? 'PostToolUseFailure' : 'PostToolUse', tool_name: tool, tool_input: input, tool_use_id: id, tool_response: { stdout: 'ok', stderr: fail ? 'Error: boom' : '', exit_code: fail ? 1 : 0 } })
    } else {
      this.send({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_use_id: id, tool_response: {} })
    }
  }
}
