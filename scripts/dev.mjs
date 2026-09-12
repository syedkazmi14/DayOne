#!/usr/bin/env node
/* ============================================================================
 * `npm run dev` — Vite plus the voice proxy, in one terminal.
 *
 * The proxy is the only process given ELEVENLABS_API_KEY, and Vite forwards
 * /api/voice to it (see vite.config.ts). Either child exiting takes the other
 * down, so Ctrl-C leaves nothing running.
 *
 * Env is read from .env.local then .env (both gitignored), without adding a
 * dotenv dependency; real environment variables always win over the files.
 * ========================================================================== */

import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Minimal .env reader: KEY=value, # comments, optional quotes. */
function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (key in process.env) continue
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadEnvFile(path.join(ROOT, '.env.local'))
loadEnvFile(path.join(ROOT, '.env'))

const children = []
let shuttingDown = false

function stopAll(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM')
  }
  process.exit(code)
}

function start(label, command, args) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env, shell: false })
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[dev] ${label} exited (${code ?? 'signal'}) — shutting down`)
      stopAll(code ?? 0)
    }
  })
  child.on('error', (e) => {
    console.error(`[dev] could not start ${label}: ${e.message}`)
    stopAll(1)
  })
  children.push(child)
}

start('voice proxy', process.execPath, ['server/voiceProxy.mjs'])
start('vite', process.execPath, ['node_modules/vite/bin/vite.js'])

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
