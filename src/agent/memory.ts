/**
 * Memory system — file-based (ASISTENKU.md)
 *
 * Memory hierarchy:
 * 1. Global: ~/.asistenku/ASISTENKU.md (all projects)
 * 2. Project: <cwd>/ASISTENKU.md (this project)
 *
 * Content is injected into system prompt.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const GLOBAL_MEMORY_DIR = join(homedir(), '.asistenku')
const GLOBAL_MEMORY_FILE = join(GLOBAL_MEMORY_DIR, 'ASISTENKU.md')
const PROJECT_MEMORY_FILE = 'ASISTENKU.md'

/**
 * Default global memory content
 */
const DEFAULT_GLOBAL_MEMORY = `# ASISTENKU.md (Global Memory)

This file contains memory and context that persists across all your asistenku sessions.

Asistenku will automatically read this file at session start and may update it with \`remember\` tool.

## User Preferences

<!-- Add your preferences here -->

## Common Commands

<!-- Document frequently used commands -->

## Key Context

<!-- Important facts about yourself, your work, your systems -->
`

const DEFAULT_PROJECT_MEMORY = `# ASISTENKU.md (Project Memory)

This file is specific to this project. Asistenku reads it at session start.

## Project Overview

<!-- Describe what this project is about -->

## Architecture

<!-- Key architectural decisions, patterns, conventions -->

## Important Files

<!-- Map of critical files and their purposes -->

## Conventions

<!-- Code style, commit message format, naming conventions -->

## Known Issues / Gotchas

<!-- Anything that tripped you up or is tricky -->
`

/**
 * Ensure global memory file exists
 */
export async function ensureGlobalMemory() {
  await mkdir(GLOBAL_MEMORY_DIR, { recursive: true })
  if (!existsSync(GLOBAL_MEMORY_FILE)) {
    await writeFile(GLOBAL_MEMORY_FILE, DEFAULT_GLOBAL_MEMORY, 'utf-8')
  }
}

/**
 * Read global memory
 */
export async function readGlobalMemory(): Promise<string> {
  await ensureGlobalMemory()
  try {
    return await readFile(GLOBAL_MEMORY_FILE, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Read project memory (cwd/ASISTENKU.md)
 */
export async function readProjectMemory(cwd: string): Promise<string> {
  const path = join(cwd, PROJECT_MEMORY_FILE)
  if (!existsSync(path)) return ''
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Append memory line to global or project memory
 */
export async function appendMemory(
  content: string,
  scope: 'global' | 'project' = 'project',
  cwd: string = process.cwd()
) {
  const line = `- ${content}\n`
  if (scope === 'global') {
    await ensureGlobalMemory()
    const existing = await readFile(GLOBAL_MEMORY_FILE, 'utf-8')
    await writeFile(GLOBAL_MEMORY_FILE, existing + line, 'utf-8')
  } else {
    const path = join(cwd, PROJECT_MEMORY_FILE)
    const existing = existsSync(path) ? await readFile(path, 'utf-8') : DEFAULT_PROJECT_MEMORY
    await writeFile(path, existing + line, 'utf-8')
  }
}

/**
 * Initialize project memory file
 */
export async function initProjectMemory(cwd: string) {
  const path = join(cwd, PROJECT_MEMORY_FILE)
  if (existsSync(path)) {
    return { created: false, path }
  }
  await writeFile(path, DEFAULT_PROJECT_MEMORY, 'utf-8')
  return { created: true, path }
}

/**
 * Build full memory context for system prompt injection
 */
export async function buildMemoryContext(cwd: string): Promise<string> {
  const [global, project] = await Promise.all([readGlobalMemory(), readProjectMemory(cwd)])

  const parts: string[] = []
  if (global.trim()) {
    parts.push(`# Global Context (from ~/.asistenku/ASISTENKU.md)\n\n${global}`)
  }
  if (project.trim()) {
    parts.push(`# Project Context (from ./ASISTENKU.md)\n\n${project}`)
  }
  return parts.join('\n\n---\n\n')
}

export { GLOBAL_MEMORY_FILE, PROJECT_MEMORY_FILE }
