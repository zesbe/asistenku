/**
 * Scheduled routines
 *
 * Define prompts/tasks that run on schedule:
 *   - cron expression
 *   - interval (every N seconds/minutes/hours)
 *   - one-shot (run at specific time)
 *
 * Routines config stored in ~/.asistenku/routines.json:
 *   [
 *     {
 *       "name": "morning-brief",
 *       "schedule": "0 9 * * *",       // cron
 *       "prompt": "Summary today's tasks",
 *       "model": "claude-sonnet-4-5",
 *       "cwd": "/home/user/project",
 *       "enabled": true
 *     }
 *   ]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../agent/loop'
import { createSession } from '../db'
import { loadConfig } from '../utils/config'

const ROUTINES_FILE = join(homedir(), '.asistenku', 'routines.json')

export interface Routine {
  id: string
  name: string
  schedule: string // cron or "every 5m" or ISO datetime
  prompt: string
  provider?: string
  model?: string
  cwd?: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  runCount: number
}

const timers: Map<string, NodeJS.Timeout> = new Map()

export async function loadRoutines(): Promise<Routine[]> {
  if (!existsSync(ROUTINES_FILE)) return []
  try {
    return JSON.parse(await readFile(ROUTINES_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export async function saveRoutines(routines: Routine[]) {
  await mkdir(join(homedir(), '.asistenku'), { recursive: true })
  await writeFile(ROUTINES_FILE, JSON.stringify(routines, null, 2))
}

export async function addRoutine(
  partial: Omit<Routine, 'id' | 'runCount'>
): Promise<Routine> {
  const routines = await loadRoutines()
  const routine: Routine = {
    id: crypto.randomUUID().substring(0, 8),
    ...partial,
    runCount: 0,
  }
  routines.push(routine)
  await saveRoutines(routines)
  if (routine.enabled) scheduleRoutine(routine)
  return routine
}

export async function removeRoutine(id: string) {
  const routines = await loadRoutines()
  const filtered = routines.filter((r) => r.id !== id)
  await saveRoutines(filtered)
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

export async function toggleRoutine(id: string, enabled: boolean) {
  const routines = await loadRoutines()
  const routine = routines.find((r) => r.id === id)
  if (!routine) throw new Error(`Routine ${id} not found`)
  routine.enabled = enabled
  await saveRoutines(routines)
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  if (enabled) scheduleRoutine(routine)
}

/**
 * Start the scheduler (call on daemon startup)
 */
export async function startScheduler() {
  const routines = await loadRoutines()
  for (const r of routines) {
    if (r.enabled) scheduleRoutine(r)
  }
  console.log(`🗓️  Scheduler started: ${timers.size} active routines`)
}

export function stopScheduler() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}

function scheduleRoutine(routine: Routine) {
  const nextRun = parseSchedule(routine.schedule, routine.lastRun)
  if (!nextRun) {
    console.warn(`⚠ Can't schedule routine ${routine.name}: invalid schedule "${routine.schedule}"`)
    return
  }
  const delay = Math.max(1000, nextRun - Date.now())
  const timer = setTimeout(() => runRoutine(routine), delay)
  timers.set(routine.id, timer)
  routine.nextRun = nextRun
}

async function runRoutine(routine: Routine) {
  try {
    const cwd = routine.cwd || process.cwd()
    const config = await loadConfig(cwd)
    const session = createSession({
      cwd,
      provider: (routine.provider as any) || config.defaultProvider,
      model: routine.model || config.defaultModel,
      title: `[routine] ${routine.name}`,
    })

    console.log(`🗓️  Running routine: ${routine.name}`)
    await runAgent({
      session,
      userMessage: routine.prompt,
      config,
    })

    // Update stats
    const routines = await loadRoutines()
    const r = routines.find((x) => x.id === routine.id)
    if (r) {
      r.lastRun = Date.now()
      r.runCount++
      await saveRoutines(routines)
    }

    // Re-schedule
    scheduleRoutine(routine)
  } catch (err: any) {
    console.error(`Routine ${routine.name} failed:`, err.message)
    scheduleRoutine(routine) // Re-schedule even on failure
  }
}

/**
 * Parse schedule to next timestamp.
 * Supports:
 *  - cron expression (5-part: "0 9 * * *")
 *  - "every 5m", "every 1h", "every 30s"
 *  - ISO datetime for one-shot
 */
function parseSchedule(schedule: string, lastRun?: number): number | null {
  const now = Date.now()

  // "every Xs/Xm/Xh"
  const intervalMatch = schedule.match(/^every\s+(\d+)\s*([smhd])$/i)
  if (intervalMatch) {
    const [, num, unit] = intervalMatch
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
    const ms = parseInt(num) * (multipliers[unit.toLowerCase()] || 0)
    return (lastRun || now) + ms
  }

  // ISO datetime
  const isoTime = Date.parse(schedule)
  if (!isNaN(isoTime) && isoTime > now) {
    return isoTime
  }

  // Cron (5-part: minute hour day-of-month month day-of-week)
  if (/^(\S+\s+){4}\S+$/.test(schedule)) {
    return nextCronTime(schedule, now)
  }

  return null
}

/**
 * Minimal cron parser (not full-featured)
 * Supports star, slash-N, N, N-N, N,N,N
 */
function nextCronTime(cron: string, from: number): number | null {
  const [minStr, hourStr, domStr, monthStr, dowStr] = cron.split(/\s+/)
  const date = new Date(from + 60_000) // Start 1 minute ahead
  date.setSeconds(0)
  date.setMilliseconds(0)

  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchCronField(date.getMinutes(), minStr, 0, 59) &&
        matchCronField(date.getHours(), hourStr, 0, 23) &&
        matchCronField(date.getDate(), domStr, 1, 31) &&
        matchCronField(date.getMonth() + 1, monthStr, 1, 12) &&
        matchCronField(date.getDay(), dowStr, 0, 6)) {
      return date.getTime()
    }
    date.setMinutes(date.getMinutes() + 1)
  }
  return null
}

function matchCronField(value: number, expr: string, min: number, max: number): boolean {
  if (expr === '*') return true

  // Step: slash-N
  const step = expr.match(/^\*\/(\d+)$/)
  if (step) return value % parseInt(step[1]) === 0

  // Range: N-N
  const range = expr.match(/^(\d+)-(\d+)$/)
  if (range) {
    return value >= parseInt(range[1]) && value <= parseInt(range[2])
  }

  // List: N,N,N
  const list = expr.split(',').map(Number)
  return list.includes(value)
}

export { ROUTINES_FILE }
