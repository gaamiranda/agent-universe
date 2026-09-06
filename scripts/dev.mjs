#!/usr/bin/env node
// Runs the server and the Vite dev server together.
import { spawn } from 'node:child_process'
const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev:client'], { stdio: 'inherit', shell: true }),
]
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => { if (code && code !== 0) stop() })
