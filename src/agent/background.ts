/**
 * Background task manager
 *
 * Spawn long-running bash commands without blocking conversation.
 * User can check status with /tasks command, or LLM can poll via wait_for_task.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TASKS_DIR = join(homedir(), '.asistenku', 'tasks')

export interface BackgroundTask {
  id: string
  sessionId: string
  command: string
  pid: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  startedAt: number
  finishedAt?: number
  exitCode?: number
  stdoutPath: string
  stderrPath: string
  cwd: string
}

const tasks: Map<string, BackgroundTask> = new Map()
const processes: Map<string, ChildProcess> = new Map()

/**
 * Start a background task
 */
export async function startBackgroundTask(
  sessionId: string,
  command: string,
  cwd: string
): Promise<BackgroundTask> {
  await mkdir(TASKS_DIR, { recursive: true })
  const id = crypto.randomUUID().substring(0, 8)
  const stdoutPath = join(TASKS_DIR, `${id}.stdout`)
  const stderrPath = join(TASKS_DIR, `${id}.stderr`)

  // Start process
  const proc = spawn('bash', ['-c', command], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const task: BackgroundTask = {
    id,
    sessionId,
    command,
    pid: proc.pid || 0,
    status: 'running',
    startedAt: Date.now(),
    stdoutPath,
    stderrPath,
    cwd,
  }

  // Buffer outputs to files
  let stdoutBuffer = ''
  let stderrBuffer = ''
  const flushInterval = setInterval(async () => {
    if (stdoutBuffer) {
      await appendFile(stdoutPath, stdoutBuffer)
      stdoutBuffer = ''
    }
    if (stderrBuffer) {
      await appendFile(stderrPath, stderrBuffer)
      stderrBuffer = ''
    }
  }, 500)

  proc.stdout.on('data', (data) => (stdoutBuffer += data.toString()))
  proc.stderr.on('data', (data) => (stderrBuffer += data.toString()))

  proc.on('close', async (code) => {
    clearInterval(flushInterval)
    if (stdoutBuffer) await appendFile(stdoutPath, stdoutBuffer)
    if (stderrBuffer) await appendFile(stderrPath, stderrBuffer)

    task.status = code === 0 ? 'completed' : code === null ? 'killed' : 'failed'
    task.finishedAt = Date.now()
    task.exitCode = code ?? -1
    processes.delete(id)
  })

  tasks.set(id, task)
  processes.set(id, proc)

  // Detach so parent can exit without waiting
  proc.unref()

  return task
}

/**
 * List tasks (optionally filter by session)
 */
export function listTasks(sessionId?: string): BackgroundTask[] {
  const all = Array.from(tasks.values())
  return sessionId ? all.filter((t) => t.sessionId === sessionId) : all
}

export function getTask(id: string): BackgroundTask | null {
  return tasks.get(id) || null
}

/**
 * Get task output
 */
export async function getTaskOutput(
  id: string,
  opts: { stdout?: boolean; stderr?: boolean; tail?: number } = { stdout: true, stderr: true }
): Promise<{ stdout: string; stderr: string }> {
  const task = tasks.get(id)
  if (!task) throw new Error(`Task ${id} not found`)

  const stdout = opts.stdout !== false && existsSync(task.stdoutPath)
    ? await readFile(task.stdoutPath, 'utf-8')
    : ''
  const stderr = opts.stderr !== false && existsSync(task.stderrPath)
    ? await readFile(task.stderrPath, 'utf-8')
    : ''

  const slice = opts.tail
    ? (s: string) => s.split('\n').slice(-opts.tail!).join('\n')
    : (s: string) => s

  return { stdout: slice(stdout), stderr: slice(stderr) }
}

/**
 * Kill a running task
 */
export function killTask(id: string): boolean {
  const proc = processes.get(id)
  if (!proc) return false
  try {
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (processes.has(id)) {
        proc.kill('SIGKILL')
      }
    }, 3000)
    const task = tasks.get(id)
    if (task) {
      task.status = 'killed'
      task.finishedAt = Date.now()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Wait for task completion (with timeout)
 */
export async function waitForTask(id: string, timeoutSec = 60): Promise<BackgroundTask> {
  const task = tasks.get(id)
  if (!task) throw new Error(`Task ${id} not found`)
  if (task.status !== 'running') return task

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(poll)
      reject(new Error(`Task ${id} did not finish within ${timeoutSec}s`))
    }, timeoutSec * 1000)

    const poll = setInterval(() => {
      const current = tasks.get(id)
      if (current && current.status !== 'running') {
        clearInterval(poll)
        clearTimeout(timer)
        resolve(current)
      }
    }, 500)
  })
}

/**
 * Cleanup finished tasks (remove output files)
 */
export async function cleanupTask(id: string) {
  const task = tasks.get(id)
  if (!task) return
  const { rm } = await import('node:fs/promises')
  try {
    await rm(task.stdoutPath, { force: true })
    await rm(task.stderrPath, { force: true })
  } catch {}
  tasks.delete(id)
}

async function appendFile(path: string, content: string) {
  const { appendFile: af } = await import('node:fs/promises')
  await af(path, content)
}
