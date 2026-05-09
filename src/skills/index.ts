/**
 * Skills system
 *
 * Skills are markdown files with YAML frontmatter that extend asistenku with
 * specialized knowledge, workflows, or procedures.
 *
 * Discovery paths (priority order):
 *   1. ./.asistenku/skills/{name}/SKILL.md (project)
 *   2. ~/.asistenku/skills/{name}/SKILL.md (global)
 *   3. Config-defined skill paths
 *
 * Skill structure:
 *   skill-name/
 *     SKILL.md             # Required, has frontmatter + content
 *     references/*.md      # Optional supporting docs
 *     scripts/*.sh         # Optional scripts
 *
 * Frontmatter fields:
 *   name: string (required)
 *   description: string (required, triggers skill visibility to LLM)
 *   allowed_tools: string[] (optional, restrict tools when skill active)
 *   auto_trigger: string[] (optional, keywords that auto-load skill)
 *   model: string (optional, force specific model)
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import matter from 'gray-matter'
import type { Config } from '../types'

export interface SkillMetadata {
  name: string
  description: string
  path: string
  allowedTools?: string[]
  autoTrigger?: string[]
  model?: string
  scope: 'project' | 'global' | 'custom'
}

export interface Skill extends SkillMetadata {
  content: string // Full markdown body
  frontmatter: Record<string, any>
}

const GLOBAL_SKILLS_DIR = join(homedir(), '.asistenku', 'skills')

/**
 * Discover all available skills
 */
export async function discoverSkills(cwd: string, config?: Config): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = []
  const seen = new Set<string>()

  // Project skills
  const projectSkillsDir = join(cwd, '.asistenku', 'skills')
  if (existsSync(projectSkillsDir)) {
    for (const meta of await scanSkillDir(projectSkillsDir, 'project')) {
      if (!seen.has(meta.name)) {
        skills.push(meta)
        seen.add(meta.name)
      }
    }
  }

  // Global skills
  if (existsSync(GLOBAL_SKILLS_DIR)) {
    for (const meta of await scanSkillDir(GLOBAL_SKILLS_DIR, 'global')) {
      if (!seen.has(meta.name)) {
        skills.push(meta)
        seen.add(meta.name)
      }
    }
  }

  // Custom paths from config
  if (config?.skills) {
    for (const customPath of config.skills) {
      if (existsSync(customPath)) {
        for (const meta of await scanSkillDir(customPath, 'custom')) {
          if (!seen.has(meta.name)) {
            skills.push(meta)
            seen.add(meta.name)
          }
        }
      }
    }
  }

  return skills
}

async function scanSkillDir(dir: string, scope: SkillMetadata['scope']): Promise<SkillMetadata[]> {
  const results: SkillMetadata[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillFile = join(dir, entry.name, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const meta = await readSkillMetadata(skillFile, scope)
      if (meta) results.push(meta)
    }
  } catch {
    // Skip unreadable dirs
  }
  return results
}

async function readSkillMetadata(
  filePath: string,
  scope: SkillMetadata['scope']
): Promise<SkillMetadata | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data
    if (!fm.name && !fm.description) return null
    return {
      name: fm.name || basename(dirname(filePath)),
      description: fm.description || '',
      path: filePath,
      allowedTools: fm.allowed_tools,
      autoTrigger: fm.auto_trigger,
      model: fm.model,
      scope,
    }
  } catch {
    return null
  }
}

/**
 * Load full skill content
 */
export async function loadSkill(skill: SkillMetadata): Promise<Skill> {
  const raw = await readFile(skill.path, 'utf-8')
  const parsed = matter(raw)
  return {
    ...skill,
    content: parsed.content,
    frontmatter: parsed.data,
  }
}

/**
 * Find skill by name
 */
export async function findSkill(
  name: string,
  cwd: string,
  config?: Config
): Promise<Skill | null> {
  const skills = await discoverSkills(cwd, config)
  const meta = skills.find((s) => s.name === name)
  if (!meta) return null
  return loadSkill(meta)
}

/**
 * Auto-match skills by user message (keyword triggers)
 */
export async function matchAutoSkills(
  message: string,
  cwd: string,
  config?: Config
): Promise<SkillMetadata[]> {
  const skills = await discoverSkills(cwd, config)
  const lowerMsg = message.toLowerCase()
  return skills.filter((s) => {
    if (!s.autoTrigger) return false
    return s.autoTrigger.some((trigger) => lowerMsg.includes(trigger.toLowerCase()))
  })
}

/**
 * Build skills catalog for system prompt injection
 * Format: compact list of name + description so LLM knows what's available
 */
export function buildSkillsCatalog(skills: SkillMetadata[]): string {
  if (!skills.length) return ''
  const lines = ['## Available Skills', '']
  lines.push('Call `activate_skill(name)` to load full skill content when you need it.')
  lines.push('')
  for (const s of skills) {
    lines.push(`- **${s.name}** (${s.scope}): ${s.description}`)
  }
  return lines.join('\n')
}

/**
 * Create skeleton SKILL.md for given name
 */
export async function scaffoldSkill(name: string, cwd: string, scope: 'project' | 'global' = 'project') {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const baseDir = scope === 'project' ? join(cwd, '.asistenku', 'skills') : GLOBAL_SKILLS_DIR
  const skillDir = join(baseDir, name)
  const skillFile = join(skillDir, 'SKILL.md')
  if (existsSync(skillFile)) {
    return { created: false, path: skillFile }
  }
  await mkdir(skillDir, { recursive: true })
  const content = `---
name: ${name}
description: Short description of what this skill does. Triggers this skill's visibility to the AI.
auto_trigger:
  - keyword1
  - keyword2
allowed_tools: []
---

# ${name}

## When to Use

Describe when this skill should be applied.

## Workflow

Step-by-step instructions for the AI to follow.

1. First step
2. Second step
3. ...

## Examples

\`\`\`
example input → expected behavior
\`\`\`

## References

- [Doc link](https://...)
`
  await writeFile(skillFile, content, 'utf-8')
  return { created: true, path: skillFile }
}

export { GLOBAL_SKILLS_DIR }
