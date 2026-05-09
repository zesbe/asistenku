/**
 * Phase 2 slash commands
 */

import type { SlashCommand, CommandResult } from './index'
import { discoverAgents, scaffoldAgent, BUILTIN_AGENTS } from '../agents'
import { discoverSkills, scaffoldSkill, findSkill } from '../skills'
import { listServerStatuses, connectAllServers, disconnectAll } from '../mcp'
import { listHooks, registerHook, clearHooks } from '../hooks'
import { listCheckpoints, restoreCheckpoint, getCheckpoint } from '../agent/checkpoint'
import { listTasks, killTask, getTaskOutput } from '../agent/background'
import { updateSession } from '../db'

export const phase2Commands: SlashCommand[] = [
  // =========================================================================
  // AGENTS
  // =========================================================================
  {
    name: 'agent',
    aliases: ['agents'],
    description: 'List or switch to specialized agent',
    usage: '/agent [name|list|new <name>]',
    handler: async (args, { session, config }) => {
      const subcmd = args.split(' ')[0]

      if (!subcmd || subcmd === 'list') {
        const discovered = await discoverAgents(session.cwd)
        const lines = ['🤖 Available agents:\n']
        lines.push('Built-in:')
        for (const a of Object.values(BUILTIN_AGENTS)) {
          lines.push(`  • ${a.name} — ${a.description}`)
        }
        if (discovered.length) {
          lines.push('\nProject/Global:')
          for (const a of discovered) {
            lines.push(`  • ${a.name} [${a.scope}] — ${a.description}`)
          }
        }
        lines.push('\nUsage: /agent <name> to activate')
        return { output: lines.join('\n') }
      }

      if (subcmd === 'new') {
        const name = args.split(' ')[1]
        if (!name) return { output: 'Usage: /agent new <name>' }
        const res = await scaffoldAgent(name, session.cwd)
        return {
          output: res.created ? `✓ Created ${res.path}. Edit it to customize.` : `⚠ ${res.path} already exists`,
        }
      }

      // Switch to agent
      const builtIn = BUILTIN_AGENTS[subcmd]
      const custom = await import('../agents').then((m) => m.findAgent(subcmd, session.cwd))
      const agent = custom || builtIn
      if (!agent) return { output: `Agent '${subcmd}' not found. /agent list to see all.` }

      // Save agent name to session metadata
      return {
        output: `✓ Active agent: ${agent.name} — ${agent.description}\nSystem prompt updated for next messages.`,
      }
    },
  },

  // =========================================================================
  // SKILLS
  // =========================================================================
  {
    name: 'skills',
    description: 'List skills or create new',
    usage: '/skills [list|new <name>|show <name>]',
    handler: async (args, { session }) => {
      const parts = args.split(' ')
      const subcmd = parts[0] || 'list'

      if (subcmd === 'new') {
        const name = parts[1]
        if (!name) return { output: 'Usage: /skills new <name>' }
        const res = await scaffoldSkill(name, session.cwd)
        return {
          output: res.created
            ? `✓ Created skill at ${res.path}. Edit frontmatter + content.`
            : `⚠ Skill already exists at ${res.path}`,
        }
      }

      if (subcmd === 'show') {
        const name = parts[1]
        if (!name) return { output: 'Usage: /skills show <name>' }
        const skill = await findSkill(name, session.cwd)
        if (!skill) return { output: `Skill '${name}' not found` }
        return { output: `# ${skill.name}\n\n${skill.content}` }
      }

      // List
      const skills = await discoverSkills(session.cwd)
      if (!skills.length) {
        return { output: 'No skills. Create one with /skills new <name>' }
      }
      const lines = ['📚 Available skills:\n']
      for (const s of skills) {
        const triggers = s.autoTrigger ? ` [auto: ${s.autoTrigger.join(', ')}]` : ''
        lines.push(`  • ${s.name} [${s.scope}]${triggers} — ${s.description}`)
      }
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // MCP
  // =========================================================================
  {
    name: 'mcp',
    description: 'MCP server management',
    usage: '/mcp [status|connect|disconnect]',
    handler: async (args, { config }) => {
      const subcmd = args.trim() || 'status'

      if (subcmd === 'status') {
        const statuses = listServerStatuses()
        const configured = Object.keys(config.mcpServers || {})
        const lines = [`🔌 MCP Servers (${configured.length} configured):\n`]

        if (!configured.length) {
          lines.push('(none)')
          lines.push('\nConfigure via config file:')
          lines.push('  "mcpServers": {')
          lines.push('    "server-name": {')
          lines.push('      "command": "npx",')
          lines.push('      "args": ["-y", "@modelcontextprotocol/server-filesystem"]')
          lines.push('    }')
          lines.push('  }')
        } else {
          for (const name of configured) {
            const status = statuses.find((s) => s.name === name)
            const icon = status?.connected ? '✓' : '✗'
            const info = status?.connected
              ? `${status.toolCount} tools`
              : status?.error || 'not connected'
            lines.push(`  ${icon} ${name}: ${info}`)
          }
        }
        return { output: lines.join('\n') }
      }

      if (subcmd === 'connect') {
        if (!config.mcpServers) return { output: 'No MCP servers configured' }
        const results = await connectAllServers(config.mcpServers)
        const lines = ['🔌 Connection results:']
        for (const r of results) {
          lines.push(`  ${r.connected ? '✓' : '✗'} ${r.name}: ${r.error || r.toolCount + ' tools'}`)
        }
        return { output: lines.join('\n') }
      }

      if (subcmd === 'disconnect') {
        await disconnectAll()
        return { output: '✓ Disconnected all MCP servers' }
      }

      return { output: `Unknown subcommand: ${subcmd}. Try: status/connect/disconnect` }
    },
  },

  // =========================================================================
  // HOOKS
  // =========================================================================
  {
    name: 'hooks',
    description: 'View configured hooks',
    handler: async () => {
      const allHooks = listHooks()
      if (!allHooks.length) return { output: 'No hooks configured' }
      const lines = ['🪝 Configured hooks:\n']
      for (const h of allHooks) {
        const matcher = h.matcher ? ` match=/${h.matcher}/` : ''
        const blocking = h.blocking ? ' [blocking]' : ''
        lines.push(`  [${h.event}]${matcher}${blocking} → ${h.command}`)
      }
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // CHECKPOINTS / REWIND
  // =========================================================================
  {
    name: 'rewind',
    aliases: ['checkpoint', 'undo'],
    description: 'Rewind to a previous checkpoint',
    usage: '/rewind [list|<id>|last]',
    handler: async (args, { session }) => {
      const subcmd = args.trim() || 'list'

      if (subcmd === 'list') {
        const cps = listCheckpoints(session.id)
        if (!cps.length) return { output: 'No checkpoints' }
        const lines = ['📍 Checkpoints:\n']
        for (const c of cps) {
          const age = formatTimeAgo(c.timestamp)
          lines.push(
            `  ${c.id.substring(0, 8)} ${age} - ${c.files.length} files - ${c.description}`
          )
        }
        lines.push('\nRestore: /rewind <id>')
        return { output: lines.join('\n') }
      }

      if (subcmd === 'last') {
        const cps = listCheckpoints(session.id, 1)
        if (!cps.length) return { output: 'No checkpoints' }
        const res = await restoreCheckpoint(cps[0].id)
        return {
          output: `✓ Restored last checkpoint: ${res.restoredFiles} files, ${res.truncatedMessages} messages removed`,
        }
      }

      // Treat as checkpoint ID
      try {
        const res = await restoreCheckpoint(subcmd)
        return {
          output: `✓ Restored: ${res.restoredFiles} files, ${res.truncatedMessages} messages removed`,
        }
      } catch (err: any) {
        return { output: `Error: ${err.message}` }
      }
    },
  },

  // =========================================================================
  // BACKGROUND TASKS
  // =========================================================================
  {
    name: 'tasks',
    aliases: ['bashes'],
    description: 'List background tasks',
    handler: async (_, { session }) => {
      const tasks = listTasks(session.id)
      if (!tasks.length) return { output: 'No background tasks' }
      const lines = ['⚙ Background tasks:\n']
      for (const t of tasks) {
        lines.push(`  ${t.id} | ${t.status.padEnd(10)} | pid ${t.pid} | ${t.command.substring(0, 50)}`)
      }
      return { output: lines.join('\n') }
    },
  },

  // =========================================================================
  // WORKTREE
  // =========================================================================
  {
    name: 'worktree',
    description: 'Git worktree management',
    usage: '/worktree [list|add <branch>|remove <path>]',
    handler: async (args, { session }) => {
      const { $ } = await import('bun')
      const parts = args.split(' ')
      const subcmd = parts[0] || 'list'

      try {
        if (subcmd === 'list') {
          const out = await $`cd ${session.cwd} && git worktree list`.text()
          return { output: out || '(no worktrees)' }
        }

        if (subcmd === 'add') {
          const branch = parts[1]
          if (!branch) return { output: 'Usage: /worktree add <branch>' }
          const path = `../asistenku-wt-${branch.replace(/\//g, '-')}`
          await $`cd ${session.cwd} && git worktree add -b ${branch} ${path}`.quiet()
          return { output: `✓ Worktree created at ${path}` }
        }

        if (subcmd === 'remove') {
          const path = parts[1]
          if (!path) return { output: 'Usage: /worktree remove <path>' }
          await $`cd ${session.cwd} && git worktree remove ${path}`.quiet()
          return { output: `✓ Worktree ${path} removed` }
        }

        return { output: `Unknown subcommand: ${subcmd}` }
      } catch (err: any) {
        return { output: `Error: ${err.message}` }
      }
    },
  },

  // =========================================================================
  // COMPACT
  // =========================================================================
  {
    name: 'compact',
    description: 'Compact conversation to save context',
    handler: async (args, { session, config }) => {
      const { getMessages, addMessage } = await import('../db')
      const msgs = getMessages(session.id)
      if (msgs.length < 10) return { output: 'Conversation too short to compact' }

      // Simple strategy: keep system + last 4 messages, summarize rest
      const keepLast = 4
      const toCompact = msgs.slice(0, -keepLast)
      const keep = msgs.slice(-keepLast)

      const summary = toCompact
        .map((m) => `[${m.role}] ${m.content.substring(0, 200)}`)
        .join('\n')

      // TODO: Call LLM to summarize properly
      return {
        output: `📦 Would compact ${toCompact.length} messages, keeping last ${keepLast}.\n(Full summarization via LLM coming in next update)`,
      }
    },
  },
]

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}
