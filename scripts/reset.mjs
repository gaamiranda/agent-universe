#!/usr/bin/env node
// Wipes the universe: deletes the local SQLite database (run with the server stopped).
import { rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['universe.db', 'universe.db-wal', 'universe.db-shm']) {
  const p = join(ROOT, 'data', f)
  if (existsSync(p)) rmSync(p)
}
console.log('✦ Universe reset. All worlds have returned to stardust.')
