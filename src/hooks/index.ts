/**
 * Hooks system — event-driven automation
 *
 * Events:
 *   pre-tool      - Before a tool is executed (can block)
 *   post-tool     - After a tool completes
 *   pre-message   - Before sending message to LLM
 *   post-message  - After LLM response received
 *   session-start - When session begins
 *   session-end   - When session exits
 *
 * Hook config:
 *   {
 *     "event": "pre-tool",
 *     "matcher": "write_file|edit_file",      // Optional regex for tool name
 *     "command": "/path/to/script.sh",        // Shell command
 *     "blocking": true                         // Wait for completion
 *   }
 *
 * Hook input (via stdin as JSON):
 *   { event, tool, args, cwd, sessionId, ... }
 *
 * Hook output (stdout):
 *   If blocking: JSON with { decision: "allow" | "deny", message?: string }
 *   Non-blocking: anything (logged)
 */

import type { HookConfig } from '../types'
import { spawn } from 'node:child_process'

export interface HookEvent {
  event: HookConfig['event']
  tool?: string
  args?: any
  result?: any
  message?: string
  response?: string
  cwd: string
  sessionId: string
  timestamp: number
}

export interface HookResult {
  decision?: 'allow' | 'deny' | 'modify'
  message?: string
  modifiedArgs?: any
  output?: string
  error?: string
  exitCode?: number
}

const hooks: HookConfig[] = []

export function registerHook(hook: HookConfig) {
  hooks.push(hook)
}

export function listHooks(event?: HookConfig['event']): HookConfig[] {
  if (!event) return hooks
  return hooks.filter((h) => h.event === event)
}

export function clearHooks() {
  hooks.length = 0
}

export function loadHooksFromConfig(configHooks?: HookConfig[]) {
  if (!configHooks) return
  for (const h of configHooks) registerHook(h)
}

/**
 * Check if hook matches the event (via matcher regex)
 */
function matchHook(hook: HookConfig, event: HookEvent): boolean {
  if (hook.event !== event.event) return false
  if (!hook.matcher) return true
  try {
    const regex = new RegExp(hook.matcher)
    if (event.tool && !regex.test(event.tool)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Dispatch a hook event to all matching hooks
 * Returns decisions from blocking hooks
 */
export async function dispatchHook(event: HookEvent): Promise<HookResult[]> {
  const matchingHooks = hooks.filter((h) => matchHook(h, event))
  const results: HookResult[] = []

  for (const hook of matchingHooks) {
    try {
      const result = await runHook(hook, event)
      results.push(result)
      // If blocking hook denies, short-circuit
      if (hook.blocking && result.decision === 'deny') {
        return results
      }
    } catch (err: any) {
      results.push({ error: err.message })
    }
  }

  return results
}

async function runHook(hook: HookConfig, event: HookEvent): Promise<HookResult> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', hook.command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: event.cwd,
      env: { ...process.env, ASISTENKU_HOOK_EVENT: event.event },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => (stdout += data.toString()))
    proc.stderr.on('data', (data) => (stderr += data.toString()))

    // Send event as JSON via stdin
    proc.stdin.write(JSON.stringify(event))
    proc.stdin.end()

    const timeout = setTimeout(() => proc.kill(), 30_000) // 30s hard limit

    proc.on('close', (code) => {
      clearTimeout(timeout)
      // Parse stdout as JSON for blocking hooks
      if (hook.blocking) {
        try {
          const parsed = JSON.parse(stdout.trim())
          resolve({
            decision: parsed.decision,
            message: parsed.message,
            modifiedArgs: parsed.modifiedArgs,
            output: stdout,
            error: stderr || undefined,
            exitCode: code || 0,
          })
        } catch {
          // If not JSON, treat as allow with output
          resolve({
            decision: code === 0 ? 'allow' : 'deny',
            output: stdout,
            error: stderr || undefined,
            exitCode: code || 0,
          })
        }
      } else {
        resolve({
          output: stdout,
          error: stderr || undefined,
          exitCode: code || 0,
        })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ error: err.message, decision: 'allow' })
    })
  })
}

/**
 * Check if any blocking hook denies
 */
export function hasDecision(results: HookResult[]): HookResult | null {
  return results.find((r) => r.decision === 'deny') || null
}

/**
 * Extract modified args from hook results (first match)
 */
export function getModifiedArgs(results: HookResult[]): any | null {
  const match = results.find((r) => r.modifiedArgs)
  return match?.modifiedArgs || null
}
