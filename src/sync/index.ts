/**
 * Cloud sync — sync sessions + memory across devices
 *
 * Strategy: rsync via SSH to user's VPS, triggered by file watcher.
 *
 * Config:
 *   "sync": {
 *     "enabled": true,
 *     "remote": "user@vps.example.com:/backups/asistenku",
 *     "interval": 60,          // seconds
 *     "include": ["sessions/", "ASISTENKU.md", "config.json"],
 *     "exclude": ["*.db-journal", "*.db-wal"],
 *     "direction": "push"      // push | pull | bidirectional
 *   }
 *
 * Triggered by:
 *  - File watcher (inotify) on ~/.asistenku/
 *  - Periodic interval
 *  - Manual: asistenku sync now
 */

import { watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const ASISTENKU_DIR = join(homedir(), '.asistenku')

export interface SyncConfig {
  enabled: boolean
  remote: string // e.g. user@host:/path
  interval?: number // seconds
  direction?: 'push' | 'pull' | 'bidirectional'
  include?: string[]
  exclude?: string[]
  sshKey?: string
  debounceMs?: number
}

let watchingTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null
let syncInProgress = false

/**
 * Start auto-sync with file watcher + interval
 */
export async function startAutoSync(cfg: SyncConfig) {
  if (!cfg.enabled || !cfg.remote) {
    console.log('⏸  Sync disabled')
    return
  }

  console.log(`☁️  Sync enabled: ${cfg.remote} (${cfg.direction || 'push'})`)

  // Initial sync
  await performSync(cfg)

  // Interval sync
  if (cfg.interval) {
    intervalTimer = setInterval(() => {
      performSync(cfg).catch((err) => console.error('Sync interval error:', err.message))
    }, cfg.interval * 1000)
  }

  // File watcher (debounced)
  const debounceMs = cfg.debounceMs || 2000
  watch(ASISTENKU_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return
    // Skip temporary/lock files
    if (filename.endsWith('.db-journal')) return
    if (filename.endsWith('.db-wal')) return
    if (filename.endsWith('.db-shm')) return
    if (filename.includes('.lock')) return

    if (watchingTimer) clearTimeout(watchingTimer)
    watchingTimer = setTimeout(() => {
      performSync(cfg).catch((err) => console.error('Sync watch error:', err.message))
    }, debounceMs)
  })

  console.log(`📡 File watcher active (debounce ${debounceMs}ms)`)
}

export function stopAutoSync() {
  if (intervalTimer) clearInterval(intervalTimer)
  if (watchingTimer) clearTimeout(watchingTimer)
  intervalTimer = null
  watchingTimer = null
}

/**
 * Perform sync operation
 */
export async function performSync(cfg: SyncConfig): Promise<{ ok: boolean; output: string }> {
  if (syncInProgress) {
    return { ok: false, output: 'Sync already in progress' }
  }
  syncInProgress = true

  try {
    const direction = cfg.direction || 'push'

    if (direction === 'push' || direction === 'bidirectional') {
      const result = await runRsync(ASISTENKU_DIR + '/', cfg.remote + '/', cfg)
      if (direction === 'push') return { ok: result.ok, output: result.output }
    }

    if (direction === 'pull' || direction === 'bidirectional') {
      const result = await runRsync(cfg.remote + '/', ASISTENKU_DIR + '/', cfg)
      return { ok: result.ok, output: result.output }
    }

    return { ok: true, output: '(no direction)' }
  } finally {
    syncInProgress = false
  }
}

async function runRsync(
  src: string,
  dest: string,
  cfg: SyncConfig
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const args = [
      '-avz',
      '--delete',
      '--timeout=30',
      '--partial',
    ]

    if (cfg.sshKey) {
      args.push('-e', `ssh -i ${cfg.sshKey} -o StrictHostKeyChecking=accept-new`)
    } else {
      args.push('-e', 'ssh -o StrictHostKeyChecking=accept-new')
    }

    for (const ex of cfg.exclude || ['*.db-journal', '*.db-wal', '*.db-shm', '*.lock']) {
      args.push('--exclude', ex)
    }

    args.push(src, dest)

    const proc = spawn('rsync', args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('close', (code) => {
      resolve({
        ok: code === 0,
        output: code === 0 ? stdout : stderr,
      })
    })
    proc.on('error', (err) => {
      resolve({ ok: false, output: err.message })
    })
  })
}

/**
 * Check sync remote is reachable
 */
export async function checkSyncConnection(cfg: SyncConfig): Promise<boolean> {
  // Extract host from "user@host:/path"
  const match = cfg.remote.match(/^([^@]+)@([^:]+):/)
  if (!match) return false
  const [, user, host] = match
  return new Promise((resolve) => {
    const proc = spawn('ssh', [
      '-o',
      'ConnectTimeout=5',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'BatchMode=yes',
      `${user}@${host}`,
      'exit',
    ])
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}
