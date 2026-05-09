/**
 * Tool registry — built-in tools for file/shell/search
 */

import { z } from 'zod'
import { $ } from 'bun'
import { readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import fg from 'fast-glob'
import type { ToolDefinition, ToolContext, ToolResult } from '../types'

/**
 * Central tool registry
 */
const tools: Map<string, ToolDefinition> = new Map()

export function registerTool(tool: ToolDefinition) {
  tools.set(tool.name, tool)
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name)
}

export function listTools(): ToolDefinition[] {
  return Array.from(tools.values())
}

/**
 * Convert to AI SDK tools format
 */
export function toAiSdkTools(allowedTools?: string[]) {
  const result: Record<string, any> = {}
  for (const [name, tool] of tools.entries()) {
    if (allowedTools && !allowedTools.includes(name)) continue
    result[name] = {
      description: tool.description,
      parameters: tool.parameters,
      execute: async (args: any) => {
        throw new Error('Tool execution must go through agent loop for permission checks')
      },
    }
  }
  return result
}

// =============================================================================
// FILE TOOLS
// =============================================================================

registerTool({
  name: 'read_file',
  description:
    'Read the content of a file from the filesystem. Use this to understand existing code before making changes.',
  category: 'file',
  readonly: true,
  parameters: z.object({
    path: z.string().describe('Path to the file (absolute or relative to cwd)'),
    offset: z.number().optional().describe('Line offset to start from (0-indexed)'),
    limit: z.number().optional().describe('Max number of lines to read'),
  }),
  execute: async ({ path, offset = 0, limit }, ctx) => {
    try {
      const fullPath = resolve(ctx.cwd, path)
      const content = await readFile(fullPath, 'utf-8')
      const lines = content.split('\n')
      const sliced = limit ? lines.slice(offset, offset + limit) : lines.slice(offset)
      const numbered = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
      return {
        ok: true,
        content: numbered,
        metadata: { totalLines: lines.length, readLines: sliced.length },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'write_file',
  description:
    'Write (or overwrite) a file with new content. Creates parent directories if needed. Use only after reading the file first if it exists.',
  category: 'file',
  dangerous: true,
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Full content to write'),
  }),
  execute: async ({ path, content }, ctx) => {
    try {
      const fullPath = resolve(ctx.cwd, path)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, 'utf-8')
      const lineCount = content.split('\n').length
      return {
        ok: true,
        content: `Wrote ${lineCount} lines to ${relative(ctx.cwd, fullPath)}`,
        metadata: { path: fullPath, lineCount },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'edit_file',
  description:
    'Replace exact text in a file with new text. Old text must match exactly (whitespace sensitive). More targeted than write_file for partial changes.',
  category: 'file',
  dangerous: true,
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    old_text: z.string().describe('Exact text to find and replace'),
    new_text: z.string().describe('Replacement text'),
    replace_all: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace all occurrences instead of just first'),
  }),
  execute: async ({ path, old_text, new_text, replace_all }, ctx) => {
    try {
      const fullPath = resolve(ctx.cwd, path)
      const content = await readFile(fullPath, 'utf-8')
      if (!content.includes(old_text)) {
        return { ok: false, content: '', error: `Text not found in ${path}` }
      }
      const newContent = replace_all
        ? content.split(old_text).join(new_text)
        : content.replace(old_text, new_text)
      await writeFile(fullPath, newContent, 'utf-8')
      const matches = replace_all ? content.split(old_text).length - 1 : 1
      return {
        ok: true,
        content: `Replaced ${matches} occurrence(s) in ${relative(ctx.cwd, fullPath)}`,
        metadata: { path: fullPath, matches },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'list_dir',
  description: 'List files and directories at the given path',
  category: 'file',
  readonly: true,
  parameters: z.object({
    path: z.string().optional().default('.').describe('Directory path (defaults to cwd)'),
    recursive: z.boolean().optional().default(false),
  }),
  execute: async ({ path, recursive }, ctx) => {
    try {
      const pattern = recursive ? '**/*' : '*'
      const entries = await fg(pattern, {
        cwd: resolve(ctx.cwd, path),
        dot: false,
        markDirectories: true,
        onlyFiles: false,
      })
      return {
        ok: true,
        content: entries.join('\n'),
        metadata: { count: entries.length },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'delete_file',
  description: 'Delete a file or directory. USE WITH CAUTION.',
  category: 'file',
  dangerous: true,
  parameters: z.object({
    path: z.string(),
    recursive: z.boolean().optional().default(false),
  }),
  execute: async ({ path, recursive }, ctx) => {
    try {
      const fullPath = resolve(ctx.cwd, path)
      await rm(fullPath, { recursive, force: false })
      return { ok: true, content: `Deleted ${relative(ctx.cwd, fullPath)}` }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

// =============================================================================
// SEARCH TOOLS
// =============================================================================

registerTool({
  name: 'grep',
  description:
    'Search file contents using regex. Respects .gitignore. Returns matching lines with file path and line number.',
  category: 'search',
  readonly: true,
  parameters: z.object({
    pattern: z.string().describe('Regex pattern'),
    path: z.string().optional().default('.').describe('Directory to search'),
    include: z.string().optional().describe('File glob to include (e.g. "*.ts")'),
    case_sensitive: z.boolean().optional().default(false),
    max_matches: z.number().optional().default(100),
  }),
  execute: async ({ pattern, path, include, case_sensitive, max_matches }, ctx) => {
    try {
      const searchPath = resolve(ctx.cwd, path)
      const files = await fg(include || '**/*', {
        cwd: searchPath,
        dot: false,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
        absolute: true,
      })

      const flags = case_sensitive ? 'g' : 'gi'
      const regex = new RegExp(pattern, flags)
      const results: string[] = []
      let totalMatches = 0

      for (const file of files) {
        try {
          const content = await readFile(file, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${relative(ctx.cwd, file)}:${i + 1}:${lines[i].trim()}`)
              totalMatches++
              if (totalMatches >= max_matches) break
            }
          }
          if (totalMatches >= max_matches) break
        } catch {
          // Skip unreadable files
        }
      }

      return {
        ok: true,
        content: results.length ? results.join('\n') : `No matches for /${pattern}/`,
        metadata: { matches: totalMatches },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

registerTool({
  name: 'glob',
  description: 'Find files matching a glob pattern. Faster than grep for file discovery.',
  category: 'search',
  readonly: true,
  parameters: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts")'),
    path: z.string().optional().default('.'),
  }),
  execute: async ({ pattern, path }, ctx) => {
    try {
      const files = await fg(pattern, {
        cwd: resolve(ctx.cwd, path),
        dot: false,
        ignore: ['node_modules/**', '.git/**', 'dist/**'],
      })
      return {
        ok: true,
        content: files.join('\n'),
        metadata: { count: files.length },
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

// =============================================================================
// SHELL TOOLS
// =============================================================================

registerTool({
  name: 'bash',
  description:
    'Execute a bash command and return stdout/stderr. Use for running tests, builds, installs, git commands, etc.',
  category: 'shell',
  dangerous: true,
  parameters: z.object({
    command: z.string().describe('Bash command to execute'),
    timeout: z.number().optional().default(120).describe('Timeout in seconds'),
    cwd: z.string().optional(),
  }),
  execute: async ({ command, timeout, cwd }, ctx) => {
    try {
      const workDir = cwd ? resolve(ctx.cwd, cwd) : ctx.cwd
      const proc = Bun.spawn(['bash', '-c', command], {
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      // Timeout handling
      const timer = setTimeout(() => proc.kill(), timeout * 1000)

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      clearTimeout(timer)

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')

      return {
        ok: exitCode === 0,
        content: output || '(no output)',
        metadata: { exitCode, command },
        error: exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
      }
    } catch (err: any) {
      return { ok: false, content: '', error: err.message }
    }
  },
})

// =============================================================================
// MEMORY / TODO TOOLS
// =============================================================================

registerTool({
  name: 'remember',
  description:
    'Save a learning or important fact to ASISTENKU.md memory file for persistent context across sessions.',
  category: 'memory',
  parameters: z.object({
    content: z.string().describe('The fact/learning to remember (one line)'),
    scope: z.enum(['project', 'global']).optional().default('project'),
  }),
  execute: async ({ content, scope }, ctx) => {
    // Implementation in memory module
    const { appendMemory } = await import('../agent/memory')
    await appendMemory(content, scope, ctx.cwd)
    return { ok: true, content: `Remembered: ${content}` }
  },
})

registerTool({
  name: 'todo',
  description: 'Add/update/list todo items for the current session',
  category: 'memory',
  parameters: z.object({
    action: z.enum(['add', 'list', 'complete', 'remove']),
    content: z.string().optional(),
    id: z.string().optional(),
  }),
  execute: async ({ action, content, id }, ctx) => {
    const { manageTodo } = await import('../db/todos')
    const result = await manageTodo(ctx.sessionId, action, { content, id })
    return { ok: true, content: result }
  },
})

/**
 * Initialize all built-in tools
 */
export function initBuiltinTools() {
  // Core tools auto-registered via imports above
  // Phase 2 tools load on demand
  import('./phase2').catch((err) => {
    console.error('Failed to load phase2 tools:', err.message)
  })
  return tools.size
}

export { tools }
