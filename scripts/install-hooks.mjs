#!/usr/bin/env node
/**
 * Adds (or removes, with --uninstall) the Agent Universe hooks to
 * ~/.claude/settings.json so every Claude Code session on this machine
 * reports to the universe. A backup of settings.json is written first.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(ROOT, 'hooks', 'agent-universe-hook.mjs')
const SETTINGS = process.env.CLAUDE_SETTINGS ?? join(homedir(), '.claude', 'settings.json')
const MARK = 'agent-universe-hook'
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd']
const SYNC = ['Stop', 'SessionEnd']
const uninstall = process.argv.includes('--uninstall')

mkdirSync(dirname(SETTINGS), { recursive: true })
let settings = {}
if (existsSync(SETTINGS)) {
  settings = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  copyFileSync(SETTINGS, SETTINGS + '.agent-universe.bak')
}
settings.hooks ??= {}
const nodeBin = process.execPath

for (const ev of EVENTS) {
  const groups = (settings.hooks[ev] ?? []).filter((g) => !JSON.stringify(g).includes(MARK))
  if (!uninstall) {
    groups.push({
      matcher: '',
      // Stop/SessionEnd run synchronously: async hooks are killed when a headless
      // session exits, and the script only takes a few ms against a local server.
      hooks: [{ type: 'command', command: `"${nodeBin}" "${HOOK}" ${ev}`, async: !SYNC.includes(ev), timeout: 5 }],
    })
  }
  if (groups.length) settings.hooks[ev] = groups
  else delete settings.hooks[ev]
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
console.log(uninstall ? `✦ Agent Universe hooks removed from ${SETTINGS}` : `✦ Agent Universe hooks installed in ${SETTINGS}`)
if (!uninstall) console.log('  New Claude Code sessions will now appear as planets. Start the app with: npm run dev')
