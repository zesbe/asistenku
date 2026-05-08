/**
 * Main TUI App — Ink-based
 */

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'
import chalk from 'chalk'
import { runAgent, type AgentEvent } from '../agent/loop'
import { getMessages } from '../db'
import { loadConfig } from '../utils/config'
import { getModelInfo, availableProviders } from '../providers'
import { slashCommands, isSlashCommand, executeSlashCommand } from '../commands'
import type { Session, Config, Message } from '../types'

interface AppProps {
  session: Session
  initialInput?: string
}

type DisplayEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; streaming?: boolean }
  | { kind: 'tool'; name: string; args: any; result?: string }
  | { kind: 'system'; text: string }
  | { kind: 'error'; text: string }

export default function App({ session, initialInput }: AppProps) {
  const [entries, setEntries] = useState<DisplayEntry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [currentSession, setCurrentSession] = useState<Session>(session)
  const { exit } = useApp()
  const { stdout } = useStdout()
  const abortRef = useRef<AbortController | null>(null)

  // Load config + history on mount
  useEffect(() => {
    ;(async () => {
      const cfg = await loadConfig(session.cwd)
      setConfig(cfg)
      // Load history from DB
      const history = getMessages(session.id)
      if (history.length) {
        setEntries(
          history.map((m) =>
            m.role === 'user'
              ? ({ kind: 'user', text: m.content } as DisplayEntry)
              : ({ kind: 'assistant', text: m.content } as DisplayEntry)
          )
        )
      }
      if (initialInput) {
        await handleSubmit(initialInput)
      }
    })()
  }, [])

  // Handle Ctrl+C for cancel/exit
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (busy && abortRef.current) {
        abortRef.current.abort()
        setBusy(false)
      } else {
        exit()
      }
    }
  })

  const handleSubmit = async (text: string) => {
    if (!text.trim() || !config) return

    // Slash command handling
    if (isSlashCommand(text)) {
      setEntries((prev) => [...prev, { kind: 'user', text }])
      const result = await executeSlashCommand(text, { session: currentSession, config, setConfig })
      if (result.action === 'exit') {
        exit()
        return
      }
      if (result.newSession) setCurrentSession(result.newSession)
      setEntries((prev) => [
        ...prev,
        { kind: 'system', text: result.output || '' },
      ])
      setInput('')
      return
    }

    setEntries((prev) => [...prev, { kind: 'user', text }])
    setInput('')
    setBusy(true)

    const abort = new AbortController()
    abortRef.current = abort

    let streamBuffer = ''
    setEntries((prev) => [...prev, { kind: 'assistant', text: '', streaming: true }])

    try {
      await runAgent({
        session: currentSession,
        userMessage: text,
        config,
        abort: abort.signal,
        onEvent: (event: AgentEvent) => {
          if (event.type === 'text-delta') {
            streamBuffer += event.data
            setEntries((prev) => {
              const updated = [...prev]
              const lastIdx = updated.length - 1
              if (updated[lastIdx]?.kind === 'assistant') {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  text: streamBuffer,
                  streaming: true,
                }
              }
              return updated
            })
          } else if (event.type === 'tool-call-start') {
            setEntries((prev) => [
              ...prev,
              { kind: 'tool', name: event.data.toolName, args: event.data.args },
            ])
          } else if (event.type === 'tool-result') {
            setEntries((prev) => {
              const updated = [...prev]
              // Find last matching tool entry
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].kind === 'tool' && !(updated[i] as any).result) {
                  updated[i] = {
                    ...updated[i],
                    result: typeof event.data.result === 'string' ? event.data.result : JSON.stringify(event.data.result),
                  } as DisplayEntry
                  break
                }
              }
              return updated
            })
          } else if (event.type === 'finish') {
            setEntries((prev) => {
              const updated = [...prev]
              const lastIdx = updated.length - 1
              if (updated[lastIdx]?.kind === 'assistant') {
                updated[lastIdx] = { ...updated[lastIdx], streaming: false }
              }
              return updated
            })
          } else if (event.type === 'error') {
            setEntries((prev) => [...prev, { kind: 'error', text: event.data }])
          }
        },
      })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setEntries((prev) => [...prev, { kind: 'error', text: err.message }])
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const modelInfo = config ? getModelInfo(currentSession.provider, currentSession.model) : null

  return (
    <Box flexDirection="column" padding={0}>
      {/* Header */}
      <Box paddingX={1} borderStyle="round" borderColor="cyan">
        <Text color="cyan" bold>
          ⚡ asistenku
        </Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">
          {currentSession.provider}/{modelInfo?.name || currentSession.model}
        </Text>
        <Text color="gray"> | </Text>
        <Text color="magenta">{currentSession.totalTokens.toLocaleString()} tokens</Text>
        <Text color="gray"> | </Text>
        <Text color="green">${currentSession.totalCost.toFixed(4)}</Text>
      </Box>

      {/* Conversation */}
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, i) => (
          <EntryView key={i} entry={entry} />
        ))}
        {busy && (
          <Box marginTop={1}>
            <Text color="yellow">
              <Spinner type="dots" />{' '}
            </Text>
            <Text color="gray"> thinking... (Ctrl+C to cancel)</Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box marginTop={1} borderStyle="round" borderColor={busy ? 'gray' : 'green'} paddingX={1}>
        <Text color="green">{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={busy ? 'Busy...' : 'Ketik pesan atau /command (Ctrl+C keluar)'}
        />
      </Box>
    </Box>
  )
}

function EntryView({ entry }: { entry: DisplayEntry }) {
  switch (entry.kind) {
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>
            {'> '}
          </Text>
          <Text>{entry.text}</Text>
        </Box>
      )
    case 'assistant':
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            asistenku:
          </Text>
          <Box paddingLeft={2}>
            <Text>{entry.text}</Text>
            {entry.streaming && <Text color="gray">▊</Text>}
          </Box>
        </Box>
      )
    case 'tool':
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            {'  ⚙ '}
            <Text bold>{entry.name}</Text>
            <Text color="gray"> {JSON.stringify(entry.args).substring(0, 80)}</Text>
          </Text>
          {entry.result && (
            <Box paddingLeft={4}>
              <Text color="gray">
                {entry.result.substring(0, 200)}
                {entry.result.length > 200 ? '...' : ''}
              </Text>
            </Box>
          )}
        </Box>
      )
    case 'system':
      return (
        <Box marginTop={1}>
          <Text color="blue">{entry.text}</Text>
        </Box>
      )
    case 'error':
      return (
        <Box marginTop={1}>
          <Text color="red">✗ {entry.text}</Text>
        </Box>
      )
  }
}
