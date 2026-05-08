#!/usr/bin/env bun
/**
 * asistenku CLI — main entry point
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

const VERSION = '0.1.0'

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
  .option('-m, --model <model>', 'Model (provider/id)')
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

    // Override provider/model from flags
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

    // Resume or create session
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

    // Check provider API key
    const available = availableProviders(config)
    if (!available.includes(session.provider)) {
      console.error(
        chalk.red(`❌ Provider '${session.provider}' has no API key configured.\n`) +
          chalk.gray(
            `Run: asistenku login, or set ${session.provider.toUpperCase()}_API_KEY env var\n`
          )
      )
      process.exit(1)
    }

    const initialInput = promptParts.length ? promptParts.join(' ') : undefined

    // Lazy load Ink + React to avoid yoga.wasm for non-TUI commands
    const [{ render }, { default: React }, { default: App }] = await Promise.all([
      import('ink'),
      import('react'),
      import('./tui/App'),
    ])
    render(React.createElement(App, { session, initialInput }))
  })

// =============================================================================
// login
// =============================================================================
program
  .command('login')
  .description('Configure API key for a provider')
  .argument('[provider]', 'Provider name (anthropic/openai/google/etc)')
  .option('-k, --key <key>', 'API key (otherwise prompt)')
  .action(async (provider, opts) => {
    if (!provider) {
      console.log('Available providers: anthropic, openai, google, deepseek, groq, openrouter, ollama')
      return
    }
    let apiKey = opts.key
    if (!apiKey) {
      // Simple prompt via readline
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

// =============================================================================
// logout
// =============================================================================
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
    if (!sessions.length) {
      console.log(chalk.gray('No sessions'))
      return
    }
    for (const s of sessions) {
      const title = s.title || `(${s.messageCount} messages)`
      console.log(
        `${chalk.cyan(s.id.substring(0, 8))} ${chalk.gray(new Date(s.updatedAt).toLocaleString())} ${chalk.yellow(s.provider + '/' + s.model)} — ${title}`
      )
    }
  })

// =============================================================================
// delete session
// =============================================================================
program
  .command('delete <id>')
  .description('Delete a session by ID')
  .action(async (id) => {
    deleteSession(id)
    console.log(chalk.green(`✓ Deleted session ${id}`))
  })

// =============================================================================
// models
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

// =============================================================================
// doctor
// =============================================================================
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
    for (const p of providers) {
      console.log(`  ${chalk.green('✓')} ${p}`)
    }
    if (providers.length === 0) {
      console.log(chalk.yellow('  ⚠ No providers configured'))
      console.log(chalk.gray('  Run: asistenku login <provider>'))
    }

    console.log(`\n${chalk.bold('Settings')}:`)
    console.log(`  Default: ${config.defaultProvider}/${config.defaultModel}`)
    console.log(`  Permission mode: ${config.permissionMode}`)
    console.log(`  Theme: ${config.theme}`)
  })

// =============================================================================
// Helper: read hidden input (for API keys)
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
        // Ctrl+C
        process.exit(130)
      } else if (chunk === '\u007f' || chunk === '\b') {
        // Backspace
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
