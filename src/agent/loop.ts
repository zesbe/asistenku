/**
 * Enhanced agent loop (Phase 2)
 *
 * New features:
 *  - Skills auto-loading (keyword triggers + LLM-callable activate_skill)
 *  - Agent personas (override system prompt + tools)
 *  - Hooks integration (pre/post tool, pre/post message, session events)
 *  - Checkpointing (before destructive ops)
 */

import { streamText, type CoreMessage, type ToolSet } from 'ai'
import { getModel, calculateCost, getModelInfo } from '../providers'
import { addMessage, getMessages, updateSession } from '../db'
import { listTools } from '../tools'
import { buildMemoryContext } from './memory'
import { discoverSkills, matchAutoSkills, buildSkillsCatalog } from '../skills'
import { findAgent } from '../agents'
import { dispatchHook, hasDecision } from '../hooks'
import { createCheckpoint } from './checkpoint'
import type { Session, Config } from '../types'

export interface AgentEvent {
  type:
    | 'text-delta'
    | 'tool-call-start'
    | 'tool-call-approved'
    | 'tool-call-denied'
    | 'tool-result'
    | 'finish'
    | 'error'
    | 'skill-loaded'
    | 'checkpoint-created'
  data: any
}

export interface AgentRunOptions {
  session: Session
  userMessage: string
  config: Config
  agentName?: string
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
  const { session, userMessage, config, agentName, approveTool, abort, onEvent } = opts

  // 0. Dispatch pre-message hook
  const preMsgResults = await dispatchHook({
    event: 'pre-message',
    message: userMessage,
    cwd: session.cwd,
    sessionId: session.id,
    timestamp: Date.now(),
  })
  const denial = hasDecision(preMsgResults)
  if (denial) {
    throw new Error(`Message blocked by hook: ${denial.message || 'no reason'}`)
  }

  // 1. Save user message
  addMessage({
    sessionId: session.id,
    role: 'user',
    content: userMessage,
  })

  // 2. Resolve agent persona (if specified)
  const agent = agentName ? await findAgent(agentName, session.cwd) : null

  // 3. Discover skills + auto-match
  const allSkills = await discoverSkills(session.cwd, config)
  const autoMatchedSkills = await matchAutoSkills(userMessage, session.cwd, config)

  // Auto-load skill content into system prompt if triggered
  let autoSkillsContent = ''
  for (const meta of autoMatchedSkills) {
    const { loadSkill } = await import('../skills')
    const skill = await loadSkill(meta)
    autoSkillsContent += `\n\n## Auto-loaded skill: ${skill.name}\n\n${skill.content}`
    onEvent?.({ type: 'skill-loaded', data: { name: skill.name } })
  }

  // 4. Build context
  const memoryContext = await buildMemoryContext(session.cwd)
  const skillsCatalog = buildSkillsCatalog(allSkills)
  const systemPrompt = buildSystemPrompt(
    session,
    memoryContext,
    skillsCatalog,
    autoSkillsContent,
    agent
  )

  const history = getMessages(session.id)
  const messages: CoreMessage[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }) as CoreMessage)

  // 5. Prepare tools (respecting agent whitelist)
  const allTools = listTools()
  const allowedToolNames = agent?.tools
  const toolsMap: ToolSet = {}
  for (const tool of allTools) {
    if (allowedToolNames && !allowedToolNames.includes(tool.name)) continue
    toolsMap[tool.name] = {
      description: tool.description,
      parameters: tool.parameters as any,
    }
  }

  // 6. Stream response
  const model = agent?.model
    ? getModel(session.provider, agent.model, config)
    : getModel(session.provider, session.model, config)

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: toolsMap,
    temperature: agent?.temperature,
    maxSteps: 30,
    abortSignal: abort,
    onStepFinish: async ({ toolCalls, toolResults }) => {
      // Emit events
      for (const call of toolCalls || []) {
        onEvent?.({ type: 'tool-call-start', data: call })

        // Pre-tool hook
        const hookResults = await dispatchHook({
          event: 'pre-tool',
          tool: call.toolName,
          args: call.args,
          cwd: session.cwd,
          sessionId: session.id,
          timestamp: Date.now(),
        })
        const hookDenial = hasDecision(hookResults)
        if (hookDenial) {
          onEvent?.({ type: 'tool-call-denied', data: hookDenial.message })
        }

        // Checkpoint for destructive file ops
        const tool = listTools().find((t) => t.name === call.toolName)
        if (tool?.dangerous && (tool.category === 'file' || tool.name === 'bash')) {
          const files = extractFilePaths(call.args)
          if (files.length) {
            try {
              const cp = await createCheckpoint(
                session.id,
                `Before ${call.toolName}`,
                files
              )
              onEvent?.({ type: 'checkpoint-created', data: cp.id })
            } catch {
              // Best effort
            }
          }
        }
      }
      for (const result of toolResults || []) {
        onEvent?.({ type: 'tool-result', data: result })

        // Post-tool hook
        await dispatchHook({
          event: 'post-tool',
          tool: (result as any).toolName,
          args: (result as any).args,
          result: (result as any).result,
          cwd: session.cwd,
          sessionId: session.id,
          timestamp: Date.now(),
        })
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

  // Get final usage
  const finalUsage = await result.usage
  const inputTokens = finalUsage?.promptTokens || 0
  const outputTokens = finalUsage?.completionTokens || 0
  const totalTokens = inputTokens + outputTokens
  const cost = calculateCost(session.provider, session.model, inputTokens, outputTokens)

  // Save assistant message
  addMessage({
    sessionId: session.id,
    role: 'assistant',
    content: fullText,
    tokens: totalTokens,
    cost,
  })

  // Post-message hook
  await dispatchHook({
    event: 'post-message',
    response: fullText,
    cwd: session.cwd,
    sessionId: session.id,
    timestamp: Date.now(),
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

function buildSystemPrompt(
  session: Session,
  memoryContext: string,
  skillsCatalog: string,
  autoSkillsContent: string,
  agent: any
): string {
  const modelInfo = getModelInfo(session.provider, session.model)
  const now = new Date()

  if (agent) {
    return `${agent.systemPrompt}

# Environment Context

- Current directory: ${session.cwd}
- Provider: ${session.provider}
- Model: ${modelInfo?.name || session.model}
- Current time: ${now.toISOString()}
- Platform: ${process.platform}

${memoryContext ? `# Memory\n\n${memoryContext}` : ''}

${skillsCatalog}${autoSkillsContent}
`
  }

  return `You are asistenku, a helpful AI coding assistant running in a terminal.

# Core Guidelines

- Be direct and concise. Match the user's language (Bahasa Indonesia campur slang is common).
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

${skillsCatalog}${autoSkillsContent}

# Tool Usage

Use tools via the standard tool-calling mechanism. Prefer short, focused tool uses over one giant action.
Briefly explain what you're doing before each tool use.
`
}

function extractFilePaths(args: any): string[] {
  const paths: string[] = []
  if (args?.path) paths.push(args.path)
  if (args?.files && Array.isArray(args.files)) paths.push(...args.files)
  if (args?.old_path) paths.push(args.old_path)
  if (args?.new_path) paths.push(args.new_path)
  return paths
}
