/**
 * Agents system
 *
 * An "agent" is a specialized configuration with:
 *  - Custom system prompt (persona, expertise)
 *  - Restricted tool set
 *  - Preferred model
 *  - Temperature + other sampling params
 *
 * Discovery paths:
 *   1. ./.asistenku/agents/{name}.json (project)
 *   2. ~/.asistenku/agents/{name}.json (global)
 *
 * Switch via `/agent <name>` or `asistenku --agent <name>`
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, extname } from 'node:path'
import type { AgentConfig } from '../types'

const GLOBAL_AGENTS_DIR = join(homedir(), '.asistenku', 'agents')

export interface AgentDefinition extends AgentConfig {
  path: string
  scope: 'project' | 'global'
}

/**
 * Discover all available agents
 */
export async function discoverAgents(cwd: string): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = []
  const seen = new Set<string>()

  const projectAgentsDir = join(cwd, '.asistenku', 'agents')
  if (existsSync(projectAgentsDir)) {
    for (const agent of await scanAgentsDir(projectAgentsDir, 'project')) {
      if (!seen.has(agent.name)) {
        agents.push(agent)
        seen.add(agent.name)
      }
    }
  }

  if (existsSync(GLOBAL_AGENTS_DIR)) {
    for (const agent of await scanAgentsDir(GLOBAL_AGENTS_DIR, 'global')) {
      if (!seen.has(agent.name)) {
        agents.push(agent)
        seen.add(agent.name)
      }
    }
  }

  return agents
}

async function scanAgentsDir(
  dir: string,
  scope: 'project' | 'global'
): Promise<AgentDefinition[]> {
  const results: AgentDefinition[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = extname(entry.name)
      if (ext !== '.json' && ext !== '.md') continue
      const filePath = join(dir, entry.name)
      const agent = await readAgent(filePath, scope)
      if (agent) results.push(agent)
    }
  } catch {
    // Skip
  }
  return results
}

async function readAgent(
  filePath: string,
  scope: 'project' | 'global'
): Promise<AgentDefinition | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(raw)
      return {
        ...parsed,
        name: parsed.name || basename(filePath, '.json'),
        path: filePath,
        scope,
      }
    } else {
      // Markdown with frontmatter
      const matter = (await import('gray-matter')).default
      const parsed = matter(raw)
      return {
        name: parsed.data.name || basename(filePath, '.md'),
        description: parsed.data.description || '',
        systemPrompt: parsed.content,
        tools: parsed.data.tools,
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        path: filePath,
        scope,
      }
    }
  } catch (err) {
    return null
  }
}

export async function findAgent(name: string, cwd: string): Promise<AgentDefinition | null> {
  const agents = await discoverAgents(cwd)
  return agents.find((a) => a.name === name) || null
}

/**
 * Create scaffold agent file
 */
export async function scaffoldAgent(
  name: string,
  cwd: string,
  scope: 'project' | 'global' = 'project'
): Promise<{ created: boolean; path: string }> {
  const baseDir = scope === 'project' ? join(cwd, '.asistenku', 'agents') : GLOBAL_AGENTS_DIR
  await mkdir(baseDir, { recursive: true })
  const path = join(baseDir, `${name}.json`)
  if (existsSync(path)) return { created: false, path }

  const template: AgentConfig = {
    name,
    description: `Specialized agent for ${name} tasks`,
    systemPrompt: `You are a specialized AI assistant for ${name} tasks.

# Role

Define your specific expertise and focus area here.

# Guidelines

- Guideline 1
- Guideline 2

# Tools

Focus primarily on these tools: [list]

# Output Format

Specify how responses should be formatted.
`,
    tools: undefined, // undefined = all tools
    model: undefined, // undefined = use session default
    temperature: 0.7,
  }

  await writeFile(path, JSON.stringify(template, null, 2), 'utf-8')
  return { created: true, path }
}

/**
 * Built-in default agents
 */
export const BUILTIN_AGENTS: Record<string, AgentConfig> = {
  general: {
    name: 'general',
    description: 'General-purpose assistant (default)',
    systemPrompt: 'You are asistenku, a helpful AI coding assistant.',
  },
  architect: {
    name: 'architect',
    description: 'Software architect — designs systems, reviews architecture',
    systemPrompt: `You are a senior software architect. You focus on:
- System design trade-offs
- Scalability, reliability, maintainability
- Technology selection
- Breaking problems into clean modules
Do NOT write implementation code unless explicitly asked. First understand requirements, propose design, then iterate.`,
    temperature: 0.3,
  },
  reviewer: {
    name: 'reviewer',
    description: 'Code reviewer — scrutinizes code for bugs, performance, security',
    systemPrompt: `You are a strict code reviewer. Focus on:
- Correctness and edge cases
- Performance issues (N+1 queries, O(n²) loops, memory leaks)
- Security vulnerabilities (injection, XSS, unsafe deserialization)
- Code style and consistency
- Test coverage
Be direct. Point out issues clearly with suggestions.`,
    tools: ['read_file', 'grep', 'glob', 'list_dir', 'bash'],
    temperature: 0.2,
  },
  debugger: {
    name: 'debugger',
    description: 'Debugger — systematic root cause analysis',
    systemPrompt: `You are a systematic debugger. Your approach:
1. Reproduce the issue (write/run test that demonstrates bug)
2. Trace the error backwards to root cause
3. Identify the minimal fix
4. Verify fix with test
5. Check for similar bugs elsewhere
Do NOT patch symptoms — find the true cause first.`,
    temperature: 0.2,
  },
  teacher: {
    name: 'teacher',
    description: 'Patient teacher — explains concepts in depth',
    systemPrompt: `You are a patient programming teacher. Your approach:
- Explain concepts clearly with analogies
- Show examples before/after
- Anticipate common misunderstandings
- Build understanding step-by-step
- Encourage questions and experimentation`,
    temperature: 0.7,
  },
  security: {
    name: 'security',
    description: 'Security auditor — finds vulnerabilities',
    systemPrompt: `You are a security auditor. Look for:
- Injection attacks (SQL, command, XSS, CSRF)
- Authentication/authorization flaws
- Exposed secrets (API keys, tokens, passwords)
- Insecure deserialization
- Crypto misuse
- Rate limiting / DoS vectors
- Privilege escalation
Produce detailed findings with severity + remediation.`,
    tools: ['read_file', 'grep', 'glob', 'list_dir', 'bash'],
    temperature: 0.2,
  },
  devops: {
    name: 'devops',
    description: 'DevOps engineer — CI/CD, infra, deployment',
    systemPrompt: `You are a DevOps engineer. Focus on:
- CI/CD pipelines (GitHub Actions, GitLab CI)
- Infrastructure as Code (Terraform, Ansible)
- Containerization (Docker, Kubernetes)
- Monitoring + observability
- Secrets management
- Security in pipelines
Prefer idempotent, declarative approaches.`,
    temperature: 0.3,
  },
}

export function listBuiltinAgents() {
  return Object.values(BUILTIN_AGENTS)
}

export { GLOBAL_AGENTS_DIR }
