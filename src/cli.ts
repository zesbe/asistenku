#!/usr/bin/env bun
/**
 * asistenku CLI — main entry point (Phase 1 + 2 + 3)
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, saveGlobalConfig, GLOBAL_CONFIG_DIR } from './utils/config'
import {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  getMessages,
} from './db'
import { availableProviders, MODEL_CATALOG } from './providers'
import { initBuiltinTools } from './tools'

const VERSION = '0.2.0'

// Initialize tool registry
initBuiltinTools()

const program = new Command()

program
  .name('asistenku')
  .description('Multi-provider AI coding CLI — open source, file-based memory 🇮🇩')
  .version(VERSION)

// =============================================================================
// Default: start chat
// =============================================================================
program
  .argument('[prompt...]', 'Initial prompt (starts interactive session)')
  .option('-r, --resume [id]', 'Resume most recent session or specific session ID')
  .option('-m, --model <model>', 'Model (provider/id or just id)')
  .option('-p, --provider <provider>', 'Provider (anthropic/openai/google/etc)')
  .option('--no-interactive', 'Headless mode — exit after single response')
  .option('--trust-all-tools', 'Auto-approve all tool calls (YOLO mode)')
  .option('--trust-tools <tools>', 'Comma-separated list of tools to auto-approve')
  .option('-a, --agent <name>', 'Use specific agent configuration')
  .option('--cwd <path>', 'Set working directory')
  .option('--json', 'Output in streaming JSON format')
  .action(async (promptParts, opts) => {
    const cwd = opts.cwd || process.cwd()
    const config = await loadConfig(cwd)

    let provider = config.defaultProvider
    let model = config.defaultModel
    if (opts.provider) provider = opts.provider
    if (opts.model) {
      if (opts.model.includes('/')) {
        const [p, m] = opts.model.split('/')
        provider = p as any
        model = m
      } else {
        model = opts.model
      }
    }

    let session
    if (opts.resume === true) {
      const sessions = listSessions(cwd, 1)
      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions to resume. Starting new.'))
        session = createSession({ cwd, provider, model })
      } else {
        session = sessions[0]
      }
    } else if (typeof opts.resume === 'string') {
      const s = getSession(opts.resume)
      if (!s) {
        console.error(chalk.red(`Session ${opts.resume} not found`))
        process.exit(1)
      }
      session = s
    } else {
      session = createSession({ cwd, provider, model })
    }

    const available = availableProviders(config)
    if (!available.includes(session.provider)) {
      console.error(
        chalk.red(`❌ Provider '${session.provider}' has no API key configured.\n`) +
          chalk.gray(`Run: asistenku login ${session.provider}\n`)
      )
      process.exit(1)
    }

    const initialInput = promptParts.length ? promptParts.join(' ') : undefined

    // Connect MCP servers if configured
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      const { connectAllServers } = await import('./mcp')
      await connectAllServers(config.mcpServers)
    }

    // Load hooks
    if (config.hooks) {
      const { loadHooksFromConfig } = await import('./hooks')
      loadHooksFromConfig(config.hooks)
    }

    // Activate plugins
    const { activateAllPlugins } = await import('./plugins')
    await activateAllPlugins(cwd)

    const [{ render }, { default: React }, { default: App }] = await Promise.all([
      import('ink'),
      import('react'),
      import('./tui/App'),
    ])
    render(React.createElement(App, { session, initialInput, agent: opts.agent }))
  })

// =============================================================================
// login / logout
// =============================================================================
program
  .command('login')
  .description('Configure API key for a provider')
  .argument('[provider]', 'Provider name (anthropic/openai/google/etc)')
  .option('-k, --key <key>', 'API key (otherwise prompt)')
  .action(async (provider, opts) => {
    if (!provider) {
      console.log('Providers: anthropic, openai, google, deepseek, groq, openrouter, ollama')
      return
    }
    let apiKey = opts.key
    if (!apiKey) {
      process.stdout.write(`Enter ${provider} API key (hidden): `)
      apiKey = await readHiddenInput()
    }
    const config = await loadConfig()
    await saveGlobalConfig({
      providers: {
        ...config.providers,
        [provider]: {
          id: provider,
          name: provider,
          apiKey,
          defaultModel: '',
          models: [],
          ...(config.providers[provider as any] || {}),
        },
      },
    })
    console.log(chalk.green(`✓ Saved ${provider} API key to ${GLOBAL_CONFIG_DIR}/config.json`))
  })

program
  .command('logout')
  .argument('[provider]', 'Provider name (empty = all)')
  .description('Remove saved API key')
  .action(async (provider) => {
    const config = await loadConfig()
    if (!provider) {
      config.providers = {}
    } else {
      delete config.providers[provider as any]
    }
    await saveGlobalConfig({ providers: config.providers })
    console.log(chalk.green(`✓ Logged out ${provider || 'all providers'}`))
  })

// =============================================================================
// sessions
// =============================================================================
program
  .command('sessions')
  .alias('list')
  .description('List saved sessions')
  .option('-a, --all', 'Show all sessions (not just cwd)')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const cwd = opts.all ? undefined : process.cwd()
    const sessions = listSessions(cwd, parseInt(opts.limit))
    if (!sessions.length) return console.log(chalk.gray('No sessions'))
    for (const s of sessions) {
      const title = s.title || `(${s.messageCount} messages)`
      console.log(
        `${chalk.cyan(s.id.substring(0, 8))} ${chalk.gray(new Date(s.updatedAt).toLocaleString())} ${chalk.yellow(s.provider + '/' + s.model)} — ${title}`
      )
    }
  })

program
  .command('delete <id>')
  .description('Delete a session by ID')
  .action(async (id) => {
    deleteSession(id)
    console.log(chalk.green(`✓ Deleted session ${id}`))
  })

// =============================================================================
// models + doctor
// =============================================================================
program
  .command('models')
  .description('List available models per provider')
  .argument('[provider]', 'Filter by provider')
  .action(async (provider) => {
    const providers = provider ? [provider] : Object.keys(MODEL_CATALOG)
    for (const p of providers) {
      const models = MODEL_CATALOG[p as any]
      if (!models?.length) continue
      console.log(chalk.bold(`\n[${p}]`))
      for (const m of models) {
        const cost = m.inputCostPer1M
          ? ` $${m.inputCostPer1M}/1M in, $${m.outputCostPer1M}/1M out`
          : ''
        console.log(
          `  ${chalk.cyan(m.id)} — ${m.name} (${m.contextWindow.toLocaleString()} ctx)${chalk.gray(cost)}`
        )
      }
    }
  })

program
  .command('doctor')
  .description('Diagnose configuration and environment')
  .action(async () => {
    const config = await loadConfig()
    console.log(chalk.bold('\n🩺 asistenku doctor\n'))
    console.log(`Version: ${VERSION}`)
    console.log(`Bun: ${Bun.version}`)
    console.log(`Platform: ${process.platform}-${process.arch}`)
    console.log(`Config dir: ${GLOBAL_CONFIG_DIR}`)

    const providers = availableProviders(config)
    console.log(`\n${chalk.bold('Providers')} (${providers.length}):`)
    for (const p of providers) console.log(`  ${chalk.green('✓')} ${p}`)
    if (providers.length === 0) {
      console.log(chalk.yellow('  ⚠ No providers configured'))
      console.log(chalk.gray('  Run: asistenku login <provider>'))
    }

    console.log(`\n${chalk.bold('Settings')}:`)
    console.log(`  Default: ${config.defaultProvider}/${config.defaultModel}`)
    console.log(`  Permission mode: ${config.permissionMode}`)
    console.log(`  Theme: ${config.theme}`)

    // Phase 2+3 status
    const { discoverAgents } = await import('./agents')
    const { discoverSkills } = await import('./skills')
    const { discoverPlugins } = await import('./plugins')
    const { loadRoutines } = await import('./routines')

    const agents = await discoverAgents(process.cwd())
    const skills = await discoverSkills(process.cwd())
    const plugins = await discoverPlugins(process.cwd())
    const routines = await loadRoutines()

    console.log(`\n${chalk.bold('Extensions')}:`)
    console.log(`  Agents: ${agents.length}`)
    console.log(`  Skills: ${skills.length}`)
    console.log(`  Plugins: ${plugins.length}`)
    console.log(`  Routines: ${routines.length}`)
    console.log(`  MCP servers configured: ${Object.keys(config.mcpServers || {}).length}`)
  })

// =============================================================================
// PHASE 2 SUBCOMMANDS
// =============================================================================

// agents
const agentCmd = program.command('agent').description('Manage agents')
agentCmd
  .command('list')
  .description('List all agents (built-in + user-defined)')
  .action(async () => {
    const { discoverAgents, BUILTIN_AGENTS } = await import('./agents')
    const builtIns = Object.values(BUILTIN_AGENTS)
    const discovered = await discoverAgents(process.cwd())
    console.log(chalk.bold('\nBuilt-in agents:'))
    for (const a of builtIns) console.log(`  ${chalk.cyan(a.name)} — ${a.description}`)
    if (discovered.length) {
      console.log(chalk.bold('\nUser agents:'))
      for (const a of discovered) {
        console.log(`  ${chalk.cyan(a.name)} [${a.scope}] — ${a.description}`)
      }
    }
  })
agentCmd
  .command('new <name>')
  .option('-g, --global', 'Create as global agent')
  .action(async (name, opts) => {
    const { scaffoldAgent } = await import('./agents')
    const res = await scaffoldAgent(name, process.cwd(), opts.global ? 'global' : 'project')
    console.log(res.created ? chalk.green(`✓ Created ${res.path}`) : chalk.yellow(`⚠ Already exists: ${res.path}`))
  })

// skills
const skillCmd = program.command('skills').description('Manage skills')
skillCmd
  .command('list')
  .action(async () => {
    const { discoverSkills } = await import('./skills')
    const skills = await discoverSkills(process.cwd())
    if (!skills.length) return console.log(chalk.gray('No skills'))
    for (const s of skills) {
      console.log(`  ${chalk.cyan(s.name)} [${s.scope}] — ${s.description}`)
    }
  })
skillCmd
  .command('new <name>')
  .option('-g, --global', 'Create globally')
  .action(async (name, opts) => {
    const { scaffoldSkill } = await import('./skills')
    const res = await scaffoldSkill(name, process.cwd(), opts.global ? 'global' : 'project')
    console.log(res.created ? chalk.green(`✓ Created ${res.path}`) : chalk.yellow(`⚠ Already exists`))
  })

// mcp
const mcpCmd = program.command('mcp').description('MCP server management')
mcpCmd
  .command('status')
  .action(async () => {
    const config = await loadConfig()
    const servers = config.mcpServers || {}
    if (!Object.keys(servers).length) {
      return console.log(chalk.gray('No MCP servers configured'))
    }
    const { listServerStatuses, connectAllServers } = await import('./mcp')
    const results = await connectAllServers(servers)
    for (const r of results) {
      console.log(`  ${r.connected ? chalk.green('✓') : chalk.red('✗')} ${r.name}: ${r.error || r.toolCount + ' tools'}`)
    }
  })

// plugins
const pluginCmd = program.command('plugin').description('Plugin management')
pluginCmd
  .command('list')
  .action(async () => {
    const { discoverPlugins } = await import('./plugins')
    const plugins = await discoverPlugins(process.cwd())
    if (!plugins.length) return console.log(chalk.gray('No plugins'))
    for (const p of plugins) {
      console.log(`  ${chalk.cyan(p.name)} v${p.version} — ${p.description || ''}`)
    }
  })
pluginCmd
  .command('new <name>')
  .option('-g, --global', 'Create globally')
  .action(async (name, opts) => {
    const { scaffoldPlugin } = await import('./plugins')
    const res = await scaffoldPlugin(name, process.cwd(), opts.global ? 'global' : 'project')
    console.log(res.created ? chalk.green(`✓ Created ${res.path}`) : chalk.yellow(`⚠ Already exists`))
  })
pluginCmd
  .command('install <source>')
  .option('-g, --global', 'Install globally')
  .action(async (source, opts) => {
    const { installPlugin } = await import('./plugins')
    const res = await installPlugin(source, { global: opts.global, cwd: process.cwd() })
    console.log(res.installed ? chalk.green(`✓ Installed to ${res.path}`) : chalk.red(`✗ ${res.error}`))
  })

// =============================================================================
// PHASE 3 SUBCOMMANDS
// =============================================================================

// serve (web UI)
program
  .command('serve')
  .description('Start web dashboard')
  .option('-p, --port <port>', 'Port', '3300')
  .option('-h, --host <host>', 'Host', '127.0.0.1')
  .option('--auth <token>', 'Require auth token')
  .action(async (opts) => {
    const { startWebUI } = await import('./web')
    await startWebUI({
      port: parseInt(opts.port),
      host: opts.host,
      auth: opts.auth,
    })
    // Keep alive
    await new Promise(() => {})
  })

// routines
const routineCmd = program.command('routine').alias('routines').description('Scheduled routines')
routineCmd
  .command('list')
  .action(async () => {
    const { loadRoutines } = await import('./routines')
    const routines = await loadRoutines()
    if (!routines.length) return console.log(chalk.gray('No routines'))
    for (const r of routines) {
      const status = r.enabled ? chalk.green('✓') : chalk.gray('✗')
      console.log(`  ${status} ${chalk.cyan(r.id)} ${chalk.bold(r.name)} "${r.schedule}" — runs: ${r.runCount}`)
    }
  })
routineCmd
  .command('add <name>')
  .requiredOption('-s, --schedule <cron>', 'Schedule: cron expr, "every 5m", or ISO datetime')
  .requiredOption('-p, --prompt <prompt>', 'Prompt to run')
  .option('-c, --cwd <path>', 'Working directory')
  .action(async (name, opts) => {
    const { addRoutine } = await import('./routines')
    const r = await addRoutine({
      name,
      schedule: opts.schedule,
      prompt: opts.prompt,
      cwd: opts.cwd,
      enabled: true,
    })
    console.log(chalk.green(`✓ Added routine ${r.id}: ${r.name}`))
  })
routineCmd
  .command('remove <id>')
  .action(async (id) => {
    const { removeRoutine } = await import('./routines')
    await removeRoutine(id)
    console.log(chalk.green(`✓ Removed routine ${id}`))
  })
routineCmd
  .command('daemon')
  .description('Run scheduler as daemon (foreground)')
  .action(async () => {
    const { startScheduler } = await import('./routines')
    await startScheduler()
    console.log(chalk.green('🗓️  Scheduler running. Press Ctrl+C to stop.'))
    await new Promise(() => {})
  })

// remote (Telegram)
const remoteCmd = program.command('remote').description('Remote control')
remoteCmd
  .command('telegram')
  .description('Start Telegram bot remote control')
  .action(async () => {
    const config = await loadConfig()
    const tgConfig = (config as any).telegram
    if (!tgConfig?.token || !tgConfig?.chatId) {
      console.error(chalk.red('Telegram config missing. Add to ~/.asistenku/config.json:'))
      console.log(JSON.stringify({ telegram: { token: 'YOUR_BOT_TOKEN', chatId: 'YOUR_CHAT_ID', enabled: true } }, null, 2))
      process.exit(1)
    }
    const { startTelegramRemote } = await import('./remote/telegram')
    await startTelegramRemote(tgConfig)
  })

// sync
const syncCmd = program.command('sync').description('Cloud sync')
syncCmd
  .command('now')
  .description('Trigger immediate sync')
  .action(async () => {
    const config = await loadConfig()
    const syncCfg = (config as any).sync
    if (!syncCfg?.enabled || !syncCfg?.remote) {
      return console.error(chalk.red('Sync config missing'))
    }
    const { performSync } = await import('./sync')
    const res = await performSync(syncCfg)
    console.log(res.ok ? chalk.green('✓ Sync complete') : chalk.red(`✗ ${res.output}`))
  })
syncCmd
  .command('daemon')
  .description('Run sync daemon (file watcher + interval)')
  .action(async () => {
    const config = await loadConfig()
    const syncCfg = (config as any).sync
    if (!syncCfg?.enabled) return console.error(chalk.red('Sync disabled'))
    const { startAutoSync } = await import('./sync')
    await startAutoSync(syncCfg)
    await new Promise(() => {})
  })
syncCmd
  .command('check')
  .description('Test connection to sync remote')
  .action(async () => {
    const config = await loadConfig()
    const syncCfg = (config as any).sync
    if (!syncCfg?.remote) return console.error(chalk.red('No remote configured'))
    const { checkSyncConnection } = await import('./sync')
    const ok = await checkSyncConnection(syncCfg)
    console.log(ok ? chalk.green('✓ Connection OK') : chalk.red('✗ Cannot connect'))
  })

// =============================================================================
// Helper: read hidden input
// =============================================================================
async function readHiddenInput(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let data = ''
    const onData = (chunk: string) => {
      if (chunk === '\r' || chunk === '\n' || chunk === '\u0004') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(data)
      } else if (chunk === '\u0003') {
        process.exit(130)
      } else if (chunk === '\u007f' || chunk === '\b') {
        data = data.slice(0, -1)
      } else {
        data += chunk
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

program.parse()
