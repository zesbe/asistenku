/**
 * Phase 2 advanced tools — skills, agents, checkpoints, background tasks, git worktree
 */

import { z } from 'zod'
import { registerTool } from './index'
import { findSkill, discoverSkills } from '../skills'
import { findAgent, discoverAgents, BUILTIN_AGENTS } from '../agents'
import {
  createCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  getCheckpoint,
} from '../agent/checkpoint'
import {
  startBackgroundTask,
  listTasks,
  getTaskOutput,
  killTask,
  waitForTask,
  getTask,
} from '../agent/background'
import { appendMemory } from '../agent/memory'
import { $ } from 'bun'

// =============================================================================
// SKILL TOOLS
// =============================================================================

registerTool({
  name: 'activate_skill',
  description:
    'Load the full content of a skill by name. Use when a user task matches a listed skill. Returns the skill content (instructions) to guide your work.',
  category: 'memory',
  readonly: true,
  parameters: z.object({
    name: z.string().describe('Skill name (as shown in available skills list)'),
  }),
  execute: async ({ name }, ctx) => {
    const skill = await findSkill(name, ctx.cwd)
    if (!skill) {
      return { ok: false, content: '', error: `Skill '${name}' not found` }
    }
    return {
      ok: true,
      content: `# Skill: ${skill.name}\n\n${skill.content}`,
      metadata: { scope: skill.scope, path: skill.path },
    }
  },
})

registerTool({
  name: 'list_skills',
  description: 'List all available skills with short descriptions',
  category: 'memory',
  readonly: true,
  parameters: z.object({}),
  execute: async (_, ctx) => {
    const skills = await discoverSkills(ctx.cwd)
    if (!skills.length) return { ok: true, content: '(no skills found)' }
    const lines = skills.map((s) => `- ${s.name} [${s.scope}]: ${s.description}`)
    return { ok: true, content: lines.join('\n'), metadata: { count: skills.length } }
  },
})

// =============================================================================
// CHECKPOINT TOOLS
// =============================================================================

registerTool({
  name: 'checkpoint',
  description:
    'Create a restore point before making destructive changes. Records current file contents so you can rewind later.',
  category: 'memory',
  parameters: z.object({
    description: z.string().describe('Short label for this checkpoint'),
    files: z.array(z.string()).describe('File paths that will be modified'),
  }),
  execute: async ({ description, files }, ctx) => {
    const cp = await createCheckpoint(ctx.sessionId, description, files)
    return {
      ok: true,
      content: `✓ Checkpoint ${cp.id.substring(0, 8)}: "${description}" (${files.length} files)`,
      metadata: { id: cp.id },
    }
  },
})

registerTool({
  name: 'list_checkpoints',
  description: 'List recent checkpoints for the current session',
  category: 'memory',
  readonly: true,
  parameters: z.object({
    limit: z.number().optional().default(10),
  }),
  execute: async ({ limit }, ctx) => {
    const cps = listCheckpoints(ctx.sessionId, limit)
    if (!cps.length) return { ok: true, content: '(no checkpoints)' }
    const lines = cps.map(
      (c) =>
        `${c.id.substring(0, 8)} | ${new Date(c.timestamp).toISOString()} | ${c.files.length} files | ${c.description}`
    )
    return { ok: true, content: lines.join('\n') }
  },
})

// =============================================================================
// BACKGROUND TASK TOOLS
// =============================================================================

registerTool({
  name: 'bash_background',
  description:
    'Run a long-running bash command in the background (e.g., dev servers, watch processes, builds). Returns task ID immediately without blocking. Use get_task_output to check progress.',
  category: 'shell',
  dangerous: true,
  parameters: z.object({
    command: z.string(),
    cwd: z.string().optional(),
  }),
  execute: async ({ command, cwd }, ctx) => {
    const workDir = cwd || ctx.cwd
    const task = await startBackgroundTask(ctx.sessionId, command, workDir)
    return {
      ok: true,
      content: `Started task ${task.id} (pid ${task.pid})`,
      metadata: { taskId: task.id, pid: task.pid },
    }
  },
})

registerTool({
  name: 'list_tasks',
  description: 'List active and recent background tasks',
  category: 'shell',
  readonly: true,
  parameters: z.object({}),
  execute: async (_, ctx) => {
    const tasks = listTasks(ctx.sessionId)
    if (!tasks.length) return { ok: true, content: '(no tasks)' }
    const lines = tasks.map(
      (t) =>
        `${t.id} | ${t.status.padEnd(10)} | pid ${t.pid} | ${t.command.substring(0, 60)}`
    )
    return { ok: true, content: lines.join('\n') }
  },
})

registerTool({
  name: 'get_task_output',
  description: 'Read stdout/stderr of a background task',
  category: 'shell',
  readonly: true,
  parameters: z.object({
    id: z.string(),
    tail: z.number().optional().describe('Last N lines only'),
  }),
  execute: async ({ id, tail }, ctx) => {
    try {
      const task = getTask(id)
      if (!task) return { ok: false, content: '', error: `Task ${id} not found` }
      const output = await getTaskOutput(id, { tail })
      return {
        ok: true,
        content: `[status: ${task.status}]\n--- stdout ---\n${output.stdout}\n--- stderr ---\n${output.stderr}`,
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'kill_task',
  description: 'Kill a running background task',
  category: 'shell',
  dangerous: true,
  parameters: z.object({ id: z.string() }),
  execute: async ({ id }, ctx) => {
    const ok = killTask(id)
    return {
      ok,
      content: ok ? `Killed task ${id}` : `Task ${id} not running`,
    }
  },
})

registerTool({
  name: 'wait_for_task',
  description: 'Wait until a background task completes (with timeout)',
  category: 'shell',
  readonly: true,
  parameters: z.object({
    id: z.string(),
    timeout: z.number().optional().default(60),
  }),
  execute: async ({ id, timeout }, ctx) => {
    try {
      const task = await waitForTask(id, timeout)
      return {
        ok: task.status === 'completed',
        content: `Task ${id} finished with status: ${task.status} (exit: ${task.exitCode})`,
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

// =============================================================================
// GIT WORKTREE TOOLS
// =============================================================================

registerTool({
  name: 'worktree_create',
  description:
    'Create an isolated git worktree for working on a separate branch without affecting current checkout. Useful for parallel tasks.',
  category: 'shell',
  dangerous: true,
  parameters: z.object({
    branch: z.string().describe('Branch name (created if not exists)'),
    path: z.string().optional().describe('Worktree path (default: ../<repo>-<branch>)'),
  }),
  execute: async ({ branch, path }, ctx) => {
    try {
      const worktreePath = path || `../asistenku-wt-${branch.replace(/\//g, '-')}`
      const result = await $`cd ${ctx.cwd} && git worktree add -b ${branch} ${worktreePath}`
        .quiet()
      return {
        ok: true,
        content: `Worktree created at ${worktreePath} (branch: ${branch})`,
        metadata: { path: worktreePath, branch },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'worktree_list',
  description: 'List git worktrees',
  category: 'shell',
  readonly: true,
  parameters: z.object({}),
  execute: async (_, ctx) => {
    try {
      const out = await $`cd ${ctx.cwd} && git worktree list`.text()
      return { ok: true, content: out }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'worktree_remove',
  description: 'Remove a git worktree',
  category: 'shell',
  dangerous: true,
  parameters: z.object({
    path: z.string(),
    force: z.boolean().optional().default(false),
  }),
  execute: async ({ path, force }, ctx) => {
    try {
      const flag = force ? '--force' : ''
      await $`cd ${ctx.cwd} && git worktree remove ${flag} ${path}`.quiet()
      return { ok: true, content: `Worktree ${path} removed` }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

// =============================================================================
// AUTO-MEMORY TOOL
// =============================================================================

registerTool({
  name: 'auto_memory',
  description:
    'Append a learned fact to project or global ASISTENKU.md memory for future sessions. Use this when discovering important context (conventions, architecture, user preferences) that should persist.',
  category: 'memory',
  parameters: z.object({
    content: z.string().describe('Fact to remember (one line, terse)'),
    scope: z.enum(['project', 'global']).default('project'),
  }),
  execute: async ({ content, scope }, ctx) => {
    await appendMemory(content, scope, ctx.cwd)
    return {
      ok: true,
      content: `✓ Remembered [${scope}]: ${content}`,
    }
  },
})

// =============================================================================
// WEB TOOLS (basic)
// =============================================================================

registerTool({
  name: 'web_fetch',
  description:
    'Fetch content from a URL. Returns body as text (truncated to 50KB). Use for reading docs, APIs, etc.',
  category: 'web',
  readonly: true,
  parameters: z.object({
    url: z.string().url(),
    max_bytes: z.number().optional().default(50_000),
  }),
  execute: async ({ url, max_bytes }, ctx) => {
    try {
      const res = await fetch(url, {
        signal: ctx.abort,
        headers: { 'User-Agent': 'asistenku/0.1.0' },
      })
      if (!res.ok) {
        return { ok: false, content: '', error: `HTTP ${res.status} ${res.statusText}` }
      }
      let text = await res.text()
      if (text.length > max_bytes) {
        text = text.substring(0, max_bytes) + `\n[... truncated ${text.length - max_bytes} bytes ...]`
      }
      return { ok: true, content: text, metadata: { status: res.status, url } }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})
