/**
 * Remote control via Telegram bot
 *
 * User sends messages to Telegram bot → asistenku processes → replies
 *
 * Setup:
 *   1. Create bot via @BotFather
 *   2. Get TOKEN + your CHAT_ID
 *   3. Configure in ~/.asistenku/config.json:
 *      "telegram": { "token": "...", "chatId": "...", "enabled": true }
 *   4. Run: asistenku remote telegram
 */

import { runAgent } from '../agent/loop'
import { createSession, getSession } from '../db'
import { loadConfig } from '../utils/config'

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    from: { id: number; username?: string; first_name?: string }
    text?: string
    date: number
  }
}

interface TelegramConfig {
  token: string
  chatId: string | number // Whitelist chat
  enabled: boolean
  cwd?: string
  provider?: string
  model?: string
}

let polling = false
let offset = 0
let activeSession: any = null

/**
 * Start Telegram bot
 */
export async function startTelegramRemote(tgConfig: TelegramConfig) {
  if (!tgConfig.token) throw new Error('Telegram token required')
  if (!tgConfig.chatId) throw new Error('Chat ID required (whitelist)')

  polling = true
  console.log('📱 Telegram bot started — send message to control asistenku')

  while (polling) {
    try {
      const updates = await pollUpdates(tgConfig.token, offset)
      for (const update of updates) {
        if (!update.message) continue
        offset = update.update_id + 1

        // Whitelist check
        if (String(update.message.chat.id) !== String(tgConfig.chatId)) {
          await sendMessage(tgConfig.token, update.message.chat.id, '⛔ Unauthorized')
          continue
        }

        if (!update.message.text) continue
        await handleMessage(tgConfig, update.message.chat.id, update.message.text)
      }
    } catch (err: any) {
      console.error('Telegram error:', err.message)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

export function stopTelegramRemote() {
  polling = false
}

async function pollUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`
  )
  const data = await res.json()
  if (!data.ok) throw new Error(data.description || 'Telegram API error')
  return data.result
}

async function sendMessage(token: string, chatId: number | string, text: string) {
  // Telegram message limit: 4096 chars
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.substring(i, i + 4000))
  }
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      }),
    }).catch(() => {
      // Try without markdown if parse fails
      return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      })
    })
  }
}

async function handleMessage(tgConfig: TelegramConfig, chatId: number, text: string) {
  try {
    // Commands
    if (text === '/start' || text === '/help') {
      await sendMessage(
        tgConfig.token,
        chatId,
        `⚡ *asistenku bot*\n\nKirim pesan untuk chat dengan AI.\n\nCommands:\n/new - Sesi baru\n/status - Status sesi\n/exit - Tutup sesi`
      )
      return
    }

    if (text === '/new') {
      const cwd = tgConfig.cwd || process.cwd()
      const config = await loadConfig(cwd)
      activeSession = createSession({
        cwd,
        provider: (tgConfig.provider as any) || config.defaultProvider,
        model: tgConfig.model || config.defaultModel,
        title: '[telegram] ' + new Date().toISOString(),
      })
      await sendMessage(tgConfig.token, chatId, `✓ Sesi baru: ${activeSession.id.substring(0, 8)}`)
      return
    }

    if (text === '/status') {
      if (!activeSession) {
        await sendMessage(tgConfig.token, chatId, 'No active session. /new to start.')
        return
      }
      await sendMessage(
        tgConfig.token,
        chatId,
        `Session: ${activeSession.id.substring(0, 8)}\nMessages: ${activeSession.messageCount}\nTokens: ${activeSession.totalTokens}\nCost: $${activeSession.totalCost.toFixed(4)}`
      )
      return
    }

    if (text === '/exit') {
      activeSession = null
      await sendMessage(tgConfig.token, chatId, '✓ Sesi ditutup')
      return
    }

    // Regular chat
    if (!activeSession) {
      const cwd = tgConfig.cwd || process.cwd()
      const config = await loadConfig(cwd)
      activeSession = createSession({
        cwd,
        provider: (tgConfig.provider as any) || config.defaultProvider,
        model: tgConfig.model || config.defaultModel,
        title: '[telegram auto]',
      })
    }

    // Indicate typing
    await fetch(`https://api.telegram.org/bot${tgConfig.token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    })

    const cwd = tgConfig.cwd || process.cwd()
    const config = await loadConfig(cwd)

    const result = await runAgent({
      session: activeSession,
      userMessage: text,
      config,
    })

    await sendMessage(tgConfig.token, chatId, result.response)
  } catch (err: any) {
    await sendMessage(tgConfig.token, chatId, `❌ Error: ${err.message}`)
  }
}
