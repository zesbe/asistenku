/**
 * REPL mode — simple readline-based interactive loop
 * No Ink/yoga.wasm dependency, works on any standalone binary.
 */

import { createInterface } from 'node:readline/promises'
import chalk from 'chalk'
import { runAgent } from '../agent/loop'
import { getMessages, updateSession, createSession } from '../db'
import { getModelInfo, availableProviders } from '../providers'
import { isSlashCommand, executeSlashCommand } from '../commands'
import type { Session, Config } from '../types'

export interface ReplOptions {
  session: Session
  config: Config
  agent?: string
}

const BANNER = `
${chalk.cyan.bold('⚡ asistenku')} ${chalk.gray('v0.2.0')}
${chalk.gray('Ketik pesan untuk chat. /help untuk commands. Ctrl+C atau /exit untuk keluar.')}
`

export async function startRepl({ session, config, agent }: ReplOptions) {
  let currentSession = session
  let abortController: AbortController | null = null

  // Load history
  const history = getMessages(session.id)
  if (history.length > 0) {
    console.log(chalk.gray(`\n📜 Resumed: ${history.length} messages\n`))
    for (const m of history.slice(-4)) {
      const role = m.role === 'user' ? chalk.cyan('› you') : chalk.green('› asistenku')
      const text = m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '')
      console.log(`${role}: ${text}\n`)
    }
  }

  console.log(BANNER)
  showStatus(currentSession, config, agent)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 1000,
    terminal: true,
  })

  // Ctrl+C handling
  rl.on('SIGINT', () => {
    if (abortController) {
      abortController.abort()
      console.log(chalk.yellow('\n[cancelled]'))
      abortController = null
    } else {
      console.log(chalk.gray('\n👋 Sampai jumpa!'))
      rl.close()
      process.exit(0)
    }
  })

  // Main loop
  while (true) {
    const prompt = chalk.green.bold('❯ ')
    let input: string
    try {
      input = await rl.question(prompt)
    } catch {
      break // Readline closed
    }

    if (!input.trim()) continue

    // Slash command
    if (isSlashCommand(input)) {
      const result = await executeSlashCommand(input, {
        session: currentSession,
        config,
        setConfig: () => {},
      })
      if (result.action === 'exit') {
        rl.close()
        process.exit(0)
      }
      if (result.newSession) {
        currentSession = result.newSession
      }
      if (result.output) {
        console.log(chalk.blue(result.output))
      }
      continue
    }

    // Chat
    abortController = new AbortController()
    console.log() // Newline before response
    process.stdout.write(chalk.green.bold('asistenku: '))

    try {
      const result = await runAgent({
        session: currentSession,
        userMessage: input,
        config,
        agentName: agent,
        abort: abortController.signal,
        onEvent: (ev) => {
          if (ev.type === 'text-delta') {
            process.stdout.write(ev.data)
          } else if (ev.type === 'tool-call-start') {
            process.stdout.write(chalk.yellow(`\n  ⚙ ${ev.data.toolName}(${JSON.stringify(ev.data.args).substring(0, 60)})\n  `))
          } else if (ev.type === 'tool-result') {
            const content =
              typeof ev.data.result === 'string'
                ? ev.data.result
                : JSON.stringify(ev.data.result)
            const preview = content.substring(0, 200) + (content.length > 200 ? '...' : '')
            process.stdout.write(chalk.gray(`  → ${preview}\n  `))
          } else if (ev.type === 'skill-loaded') {
            process.stdout.write(chalk.cyan(`  📚 skill: ${ev.data.name}\n  `))
          } else if (ev.type === 'error') {
            console.error(chalk.red(`\n✗ ${ev.data}`))
          }
        },
      })

      console.log() // End response
      if (config.showTokenCount || config.showCost) {
        console.log(
          chalk.gray(
            `  [${result.tokens} tok, $${result.cost.toFixed(4)} | total $${currentSession.totalCost.toFixed(4)}]`
          )
        )
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(chalk.red(`\n✗ ${err.message}`))
      }
    } finally {
      abortController = null
      console.log()
    }
  }

  rl.close()
}

function showStatus(session: Session, config: Config, agent?: string) {
  const modelInfo = getModelInfo(session.provider, session.model)
  const parts = [
    chalk.yellow(`${session.provider}/${modelInfo?.name || session.model}`),
  ]
  if (agent) parts.push(chalk.magenta(`agent: ${agent}`))
  parts.push(chalk.gray(`cwd: ${session.cwd}`))
  if (session.messageCount > 0) {
    parts.push(chalk.gray(`${session.messageCount} msgs`))
  }
  console.log(parts.join(chalk.gray(' • ')) + '\n')
}
