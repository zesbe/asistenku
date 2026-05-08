/**
 * Core agent loop
 *
 * Handles:
 *  - Streaming response from LLM
 *  - Tool call execution
 *  - Permission checks
 *  - Context management
 *  - Message persistence
 */

import { streamText, type CoreMessage, type ToolSet } from 'ai'
import { getModel, calculateCost, getModelInfo } from '../providers'
import { addMessage, getMessages, updateSession } from '../db'
import { checkPermission } from './permissions'
import { listTools, getTool } from '../tools'
import { buildMemoryContext } from './memory'
import type { Session, Config, ToolContext, StreamEvent } from '../types'
import { z } from 'zod'

export interface AgentEvent {
  type:
    | 'text-delta'
    | 'tool-call-start'
    | 'tool-call-approved'
    | 'tool-call-denied'
    | 'tool-result'
    | 'finish'
    | 'error'
  data: any
}

export interface AgentRunOptions {
  session: Session
  userMessage: string
  config: Config
  approveTool?: (toolName: string, args: any) => Promise<boolean>
  abort?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

/**
 * Run one turn of the agent
 */
export async function runAgent(opts: AgentRunOptions): Promise<{
  response: string
  tokens: number
  cost: number
}> {
  const { session, userMessage, config, approveTool, abort, onEvent } = opts

  // 1. Save user message
  addMessage({
    sessionId: session.id,
    role: 'user',
    content: userMessage,
  })

  // 2. Build context: system prompt + memory + history
  const memoryContext = await buildMemoryContext(session.cwd)
  const systemPrompt = buildSystemPrompt(session, memoryContext)

  const history = getMessages(session.id)
  const messages: CoreMessage[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }) as CoreMessage)

  // 3. Prepare tools
  const allTools = listTools()
  const toolsMap: ToolSet = {}
  for (const tool of allTools) {
    toolsMap[tool.name] = {
      description: tool.description,
      parameters: tool.parameters as any,
    }
  }

  // 4. Stream response
  const model = getModel(session.provider, session.model, config)

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: toolsMap,
    maxSteps: 25, // Allow multi-step tool use
    abortSignal: abort,
    onStepFinish: async ({ toolCalls, toolResults, usage }) => {
      // Called after each step (LLM generate + tool exec)
      for (const call of toolCalls || []) {
        onEvent?.({ type: 'tool-call-start', data: call })
      }
      for (const result of toolResults || []) {
        onEvent?.({ type: 'tool-result', data: result })
      }
    },
  })

  // Collect full response text while streaming
  let fullText = ''
  try {
    for await (const chunk of result.textStream) {
      fullText += chunk
      onEvent?.({ type: 'text-delta', data: chunk })
    }
  } catch (err: any) {
    onEvent?.({ type: 'error', data: err.message })
    throw err
  }

  // 5. Get final usage
  const finalUsage = await result.usage
  const inputTokens = finalUsage?.promptTokens || 0
  const outputTokens = finalUsage?.completionTokens || 0
  const totalTokens = inputTokens + outputTokens
  const cost = calculateCost(session.provider, session.model, inputTokens, outputTokens)

  // 6. Save assistant message
  addMessage({
    sessionId: session.id,
    role: 'assistant',
    content: fullText,
    tokens: totalTokens,
    cost,
  })

  onEvent?.({
    type: 'finish',
    data: { tokens: totalTokens, cost, inputTokens, outputTokens },
  })

  return {
    response: fullText,
    tokens: totalTokens,
    cost,
  }
}

/**
 * Build system prompt with memory + instructions
 */
function buildSystemPrompt(session: Session, memoryContext: string): string {
  const modelInfo = getModelInfo(session.provider, session.model)
  const now = new Date()

  return `You are asistenku, a helpful AI coding assistant running in a terminal.

# Core Guidelines

- Be direct and concise. Match the user's language (Bahasa Indonesia campur Indonesian slang is common).
- Use tools when appropriate. Prefer reading files before editing.
- Respect permissions. Dangerous tools (bash, write, delete) need approval.
- Don't claim success without verification — run tests, check outputs.
- When unsure, ask one focused question rather than assuming.

# Context

- Current directory: ${session.cwd}
- Provider: ${session.provider}
- Model: ${modelInfo?.name || session.model}
- Context window: ${modelInfo?.contextWindow || 'unknown'} tokens
- Current time: ${now.toISOString()}
- Platform: ${process.platform}

${memoryContext ? `# Memory / Project Context\n\n${memoryContext}` : ''}

# Available Tools

Use the tools provided to interact with the filesystem, run commands, and search code.
Format tool calls using the standard tool-calling mechanism.

Prefer short, focused tool uses over one giant action. Explain what you're doing briefly before each tool use.
`
}
