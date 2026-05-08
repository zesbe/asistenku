/**
 * Slash commands system
 */

import type { Session, Config } from '../types'
import { listSessions, deleteSession, updateSession, createSession } from '../db'
import { availableProviders, getModelInfo, MODEL_CATALOG } from '../providers'
import { listTools } from '../tools'
import { saveGlobalConfig, saveProjectConfig } from '../utils/config'
import { initProjectMemory, readProjectMemory, readGlobalMemory, GLOBAL_MEMORY_FILE, PROJECT_MEMORY_FILE } from '../agent/memory'
import { listPermissionRules, clearPermissionRules } from '../agent/permissions'
import { addTodo, listTodos, completeTodo, removeTodo } from '../db/todos'

export interface CommandContext {
  session: Session
  config: Config
  setConfig: (c: Config) => void
}

export interface CommandResult {
  output: string
  action?: 'exit' | 'clear' | 'continue'
  newSession?: Session
}

export type SlashCommand = {
  name: string
  aliases?: string[]
  description: string
  usage?: string
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>
}

/**
 * Registry of slash commands
 */
export const slashCommands: SlashCommand[] = [
  // =========================================================================
  // HELP
  // =========================================================================
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands',
    handler: async () => {
      const lines = ['📋 Available commands:\n']
      for (const cmd of slashCommands) {
        const aliases = cmd.aliases?.length ? ` (${cmd.aliases.map((a) => '/' + a).join(', ')})` : ''
        lines.push(`  /${cmd.name}${aliases} — ${cmd.description}`)
      }
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // EXIT
  // =========================================================================
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit asistenku',
    handler: async () => ({ output: 'Sampai jumpa! 👋', action: 'exit' }),
  },

  // =========================================================================
  // CLEAR
  // =========================================================================
  {
    name: 'clear',
    aliases: ['reset', 'new'],
    description: 'Start a new conversation (fresh context)',
    handler: async (_, { session, config }) => {
      const newSession = createSession({
        cwd: session.cwd,
        provider: session.provider,
        model: session.model,
      })
      return {
        output: `🗑️  Started fresh session. Previous conversation saved.`,
        newSession,
      }
    },
  },

  // =========================================================================
  // MODEL
  // =========================================================================
  {
    name: 'model',
    description: 'Change AI model',
    usage: '/model [provider/model]',
    handler: async (args, { session, config }) => {
      if (!args.trim()) {
        const lines = [`Current: ${session.provider}/${session.model}\n`, 'Available:']
        for (const prov of availableProviders(config)) {
          lines.push(`\n  [${prov}]`)
          for (const m of MODEL_CATALOG[prov] || []) {
            lines.push(`    • ${m.id} — ${m.name} (${m.contextWindow.toLocaleString()} ctx)`)
          }
        }
        lines.push('\nUsage: /model <provider>/<model-id>')
        return { output: lines.join('\n') }
      }
      const [provider, model] = args.trim().split('/')
      if (!provider || !model) {
        return { output: 'Usage: /model <provider>/<model-id>' }
      }
      updateSession(session.id, { provider: provider as any, model })
      return {
        output: `✓ Switched to ${provider}/${model}`,
        newSession: { ...session, provider: provider as any, model },
      }
    },
  },

  // =========================================================================
  // CONFIG
  // =========================================================================
  {
    name: 'config',
    aliases: ['settings'],
    description: 'Show current configuration',
    handler: async (_, { config }) => {
      const masked = JSON.parse(JSON.stringify(config)) // deep clone
      // Mask API keys
      if (masked.providers) {
        for (const key in masked.providers) {
          if (masked.providers[key]?.apiKey) {
            masked.providers[key].apiKey =
              masked.providers[key].apiKey.substring(0, 8) + '...' + masked.providers[key].apiKey.slice(-4)
          }
        }
      }
      return { output: '```json\n' + JSON.stringify(masked, null, 2) + '\n```' }
    },
  },

  // =========================================================================
  // CONTEXT
  // =========================================================================
  {
    name: 'context',
    description: 'Show context usage',
    handler: async (_, { session }) => {
      const info = getModelInfo(session.provider, session.model)
      const max = info?.contextWindow || 200000
      const used = session.totalTokens
      const pct = ((used / max) * 100).toFixed(1)
      const bar = '█'.repeat(Math.min(50, Math.floor(used / max * 50)))
      const empty = '░'.repeat(50 - Math.min(50, Math.floor(used / max * 50)))
      return {
        output: `📊 Context window: ${used.toLocaleString()} / ${max.toLocaleString()} (${pct}%)
[${bar}${empty}]
Cost so far: $${session.totalCost.toFixed(4)}
Messages: ${session.messageCount}`,
      }
    },
  },

  // =========================================================================
  // LIST SESSIONS
  // =========================================================================
  {
    name: 'sessions',
    aliases: ['list'],
    description: 'List saved sessions',
    handler: async (_, { session }) => {
      const sessions = listSessions(session.cwd, 20)
      if (!sessions.length) return { output: 'No sessions yet' }
      const lines = ['📜 Recent sessions:\n']
      for (const s of sessions) {
        const active = s.id === session.id ? ' ← current' : ''
        const timeAgo = formatTimeAgo(s.updatedAt)
        lines.push(
          `  ${s.id.substring(0, 8)} | ${timeAgo} | ${s.messageCount} msg | ${s.provider}/${s.model}${active}`
        )
      }
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // MEMORY
  // =========================================================================
  {
    name: 'memory',
    description: 'View/edit memory files (ASISTENKU.md)',
    handler: async (args, { session }) => {
      if (args === 'init') {
        const result = await initProjectMemory(session.cwd)
        return {
          output: result.created
            ? `✓ Created ${result.path}`
            : `⚠ Memory file already exists: ${result.path}`,
        }
      }
      const project = await readProjectMemory(session.cwd)
      const global = await readGlobalMemory()
      return {
        output: `📝 Global (${GLOBAL_MEMORY_FILE}):\n${global.substring(0, 500)}${global.length > 500 ? '...' : ''}\n\n📝 Project (${session.cwd}/${PROJECT_MEMORY_FILE}):\n${project.substring(0, 500) || '(empty)'}${project.length > 500 ? '...' : ''}\n\nUse /memory init to create project memory file.`,
      }
    },
  },

  // =========================================================================
  // TOOLS
  // =========================================================================
  {
    name: 'tools',
    description: 'List available tools',
    handler: async () => {
      const tools = listTools()
      const byCat: Record<string, string[]> = {}
      for (const t of tools) {
        byCat[t.category] = byCat[t.category] || []
        byCat[t.category].push(
          `  • ${t.name}${t.dangerous ? ' ⚠' : ''}${t.readonly ? ' 👁' : ''} — ${t.description.substring(0, 60)}`
        )
      }
      const lines = ['🛠 Available tools:']
      for (const [cat, items] of Object.entries(byCat)) {
        lines.push(`\n[${cat}]`)
        lines.push(...items)
      }
      lines.push('\n⚠ = dangerous (requires approval)  👁 = read-only')
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // PERMISSIONS
  // =========================================================================
  {
    name: 'permissions',
    aliases: ['perms'],
    description: 'Show current permission mode + saved rules',
    handler: async (_, { session, config }) => {
      const rules = listPermissionRules(session.cwd)
      const lines = [`Mode: ${config.permissionMode}\n`, 'Rules:']
      if (!rules.length) lines.push('  (none)')
      for (const r of rules) {
        lines.push(`  [${r.scope}] ${r.tool} → ${r.action}`)
      }
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // TODOS
  // =========================================================================
  {
    name: 'todos',
    description: 'Show session todos',
    handler: async (_, { session }) => {
      const todos = listTodos(session.id)
      if (!todos.length) return { output: 'No todos' }
      return {
        output: todos
          .map((t) => `${t.status === 'completed' ? '[x]' : '[ ]'} ${t.content}`)
          .join('\n'),
      }
    },
  },

  // =========================================================================
  // COST
  // =========================================================================
  {
    name: 'cost',
    aliases: ['usage'],
    description: 'Show session cost + token usage',
    handler: async (_, { session }) => {
      return {
        output: `💰 Session cost: $${session.totalCost.toFixed(4)}
📊 Tokens: ${session.totalTokens.toLocaleString()}
💬 Messages: ${session.messageCount}`,
      }
    },
  },

  // =========================================================================
  // INIT
  // =========================================================================
  {
    name: 'init',
    description: 'Initialize project memory file (ASISTENKU.md)',
    handler: async (_, { session }) => {
      const result = await initProjectMemory(session.cwd)
      return {
        output: result.created
          ? `✓ Created ${result.path}. Edit it to add project context.`
          : `⚠ ${result.path} already exists`,
      }
    },
  },

  // =========================================================================
  // DOCTOR
  // =========================================================================
  {
    name: 'doctor',
    description: 'Diagnose configuration + environment',
    handler: async (_, { session, config }) => {
      const providers = availableProviders(config)
      const lines = ['🩺 asistenku doctor\n']
      lines.push(`Version: 0.1.0`)
      lines.push(`Bun: ${Bun.version}`)
      lines.push(`Platform: ${process.platform}-${process.arch}`)
      lines.push(`Config: ${Object.keys(config).length} keys`)
      lines.push(`\nProviders available: ${providers.length}`)
      for (const p of providers) {
        lines.push(`  ✓ ${p}`)
      }
      if (providers.length === 0) {
        lines.push('  ⚠ No providers configured. Set API keys in env or ~/.asistenku/.env')
      }
      lines.push(`\nTools loaded: ${listTools().length}`)
      lines.push(`\nPermission mode: ${config.permissionMode}`)
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // SAVE / EXPORT
  // =========================================================================
  {
    name: 'save',
    aliases: ['export'],
    description: 'Export current session to JSON',
    usage: '/save [filename]',
    handler: async (args, { session }) => {
      const filename = args.trim() || `asistenku-session-${session.id.substring(0, 8)}.json`
      const { getMessages } = await import('../db')
      const messages = getMessages(session.id)
      const data = {
        format: 'asistenku-session-v1',
        session,
        messages,
        exportedAt: Date.now(),
      }
      await Bun.write(filename, JSON.stringify(data, null, 2))
      return { output: `✓ Saved to ${filename}` }
    },
  },
]

export function isSlashCommand(text: string): boolean {
  return text.startsWith('/')
}

export async function executeSlashCommand(
  text: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const [cmdName, ...argParts] = text.slice(1).split(' ')
  const args = argParts.join(' ')

  const cmd = slashCommands.find(
    (c) => c.name === cmdName || (c.aliases && c.aliases.includes(cmdName))
  )

  if (!cmd) {
    return { output: `Unknown command: /${cmdName}. Type /help to see all commands.` }
  }

  try {
    return await cmd.handler(args, ctx)
  } catch (err: any) {
    return { output: `Error executing /${cmdName}: ${err.message}` }
  }
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (day > 0) return `${day}d ago`
  if (hr > 0) return `${hr}h ago`
  if (min > 0) return `${min}m ago`
  return `${sec}s ago`
}
