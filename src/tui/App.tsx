/**
 * Main TUI App — Ink-based with interactive tool approval
 */

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'
import { runAgent, type AgentEvent } from '../agent/loop'
import { getMessages } from '../db'
import { loadConfig } from '../utils/config'
import { getModelInfo } from '../providers'
import { checkPermission, savePermissionRule } from '../agent/permissions'
import { getTool } from '../tools'
import { isSlashCommand, executeSlashCommand } from '../commands'
import type { Session, Config } from '../types'

interface AppProps {
  session: Session
  initialInput?: string
  agent?: string
}

type DisplayEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; streaming?: boolean }
  | { kind: 'tool'; name: string; args: any; result?: string; approved?: boolean }
  | { kind: 'system'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'info'; text: string }

interface ApprovalRequest {
  toolName: string
  args: any
  resolve: (decision: 'allow' | 'allow-always' | 'deny' | 'deny-always') => void
}

export default function App({ session, initialInput, agent }: AppProps) {
  const [entries, setEntries] = useState<DisplayEntry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [currentSession, setCurrentSession] = useState<Session>(session)
  const [approvalReq, setApprovalReq] = useState<ApprovalRequest | null>(null)
  const [approvalSelected, setApprovalSelected] = useState<number>(0)
  const { exit } = useApp()
  const abortRef = useRef<AbortController | null>(null)

  // Load config + history on mount
  useEffect(() => {
    ;(async () => {
      const cfg = await loadConfig(session.cwd)
      setConfig(cfg)
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

  // Handle keyboard: approval dialog navigation + Ctrl+C
  useInput((inputStr, key) => {
    if (approvalReq) {
      if (key.upArrow) {
        setApprovalSelected((s) => Math.max(0, s - 1))
      } else if (key.downArrow) {
        setApprovalSelected((s) => Math.min(3, s + 1))
      } else if (key.return) {
        const choices = ['allow', 'allow-always', 'deny', 'deny-always'] as const
        approvalReq.resolve(choices[approvalSelected])
        setApprovalReq(null)
        setApprovalSelected(0)
      } else if (inputStr === 'y' || inputStr === 'a') {
        approvalReq.resolve('allow')
        setApprovalReq(null)
      } else if (inputStr === 'n' || inputStr === 'd') {
        approvalReq.resolve('deny')
        setApprovalReq(null)
      }
      return
    }

    if (key.ctrl && inputStr === 'c') {
      if (busy && abortRef.current) {
        abortRef.current.abort()
        setBusy(false)
      } else {
        exit()
      }
    }
  })

  const requestApproval = (toolName: string, args: any): Promise<boolean> => {
    return new Promise((resolve) => {
      setApprovalReq({
        toolName,
        args,
        resolve: (decision) => {
          if (decision === 'allow-always') {
            savePermissionRule(toolName, 'allow', 'session')
            resolve(true)
          } else if (decision === 'deny-always') {
            savePermissionRule(toolName, 'deny', 'session')
            resolve(false)
          } else {
            resolve(decision === 'allow')
          }
        },
      })
    })
  }

  const handleSubmit = async (text: string) => {
    if (!text.trim() || !config) return

    // Slash command handling
    if (isSlashCommand(text)) {
      setEntries((prev) => [...prev, { kind: 'user', text }])
      const result = await executeSlashCommand(text, {
        session: currentSession,
        config,
        setConfig,
      })
      if (result.action === 'exit') {
        exit()
        return
      }
      if (result.newSession) setCurrentSession(result.newSession)
      setEntries((prev) => [...prev, { kind: 'system', text: result.output || '' }])
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
        agentName: agent,
        approveTool: async (toolName, args) => {
          const tool = getTool(toolName)
          if (!tool) return false
          const decision = checkPermission(tool, args, config.permissionMode, currentSession.cwd)
          if (decision === 'allow') return true
          if (decision === 'deny') return false
          return requestApproval(toolName, args)
        },
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
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].kind === 'tool' && !(updated[i] as any).result) {
                  const content =
                    typeof event.data.result === 'string'
                      ? event.data.result
                      : JSON.stringify(event.data.result)
                  updated[i] = { ...updated[i], result: content } as DisplayEntry
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
          } else if (event.type === 'skill-loaded') {
            setEntries((prev) => [
              ...prev,
              { kind: 'info', text: `📚 Auto-loaded skill: ${event.data.name}` },
            ])
          } else if (event.type === 'checkpoint-created') {
            setEntries((prev) => [
              ...prev,
              { kind: 'info', text: `📍 Checkpoint saved (id: ${event.data.substring(0, 8)})` },
            ])
          } else if (event.type === 'error') {
            setEntries((prev) => [...prev, { kind: 'error', text: event.data }])
          } else if (event.type === 'tool-call-denied') {
            setEntries((prev) => [
              ...prev,
              { kind: 'error', text: `Tool denied: ${event.data}` },
            ])
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
        {agent && (
          <>
            <Text color="gray"> | </Text>
            <Text color="magenta">agent: {agent}</Text>
          </>
        )}
        <Text color="gray"> | </Text>
        <Text color="magenta">{currentSession.totalTokens.toLocaleString()} tok</Text>
        <Text color="gray"> | </Text>
        <Text color="green">${currentSession.totalCost.toFixed(4)}</Text>
      </Box>

      {/* Conversation */}
      <Box flexDirection="column" marginTop={1}>
        {entries.slice(-40).map((entry, i) => (
          <EntryView key={i} entry={entry} />
        ))}
        {busy && !approvalReq && (
          <Box marginTop={1}>
            <Text color="yellow">
              <Spinner type="dots" />{' '}
            </Text>
            <Text color="gray"> thinking... (Ctrl+C to cancel)</Text>
          </Box>
        )}
      </Box>

      {/* Tool Approval Dialog */}
      {approvalReq && (
        <ApprovalDialog req={approvalReq} selected={approvalSelected} />
      )}

      {/* Input */}
      {!approvalReq && (
        <Box marginTop={1} borderStyle="round" borderColor={busy ? 'gray' : 'green'} paddingX={1}>
          <Text color="green">{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={busy ? 'Busy...' : 'Pesan atau /command (Ctrl+C keluar)'}
          />
        </Box>
      )}
    </Box>
  )
}

function ApprovalDialog({
  req,
  selected,
}: {
  req: ApprovalRequest
  selected: number
}) {
  const choices = [
    { key: 'allow', label: '✓ Allow once', color: 'green' },
    { key: 'allow-always', label: '✓ Allow always (session)', color: 'green' },
    { key: 'deny', label: '✗ Deny once', color: 'red' },
    { key: 'deny-always', label: '✗ Deny always (session)', color: 'red' },
  ]

  const argsPreview = JSON.stringify(req.args, null, 2).substring(0, 300)

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
    >
      <Text color="yellow" bold>
        🛠  Tool approval: <Text color="cyan">{req.toolName}</Text>
      </Text>
      <Box marginTop={1} paddingLeft={2}>
        <Text color="gray">{argsPreview}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {choices.map((c, i) => (
          <Box key={c.key}>
            <Text color={i === selected ? c.color : 'gray'}>
              {i === selected ? '▶ ' : '  '}
              {c.label}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ navigate · Enter select · y=allow · n=deny
        </Text>
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
    case 'info':
      return (
        <Box marginTop={0}>
          <Text color="cyan" dimColor>
            {entry.text}
          </Text>
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
