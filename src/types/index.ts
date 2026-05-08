/**
 * Core types for asistenku
 */

import type { CoreMessage, LanguageModel, Tool } from 'ai'

export type Role = 'user' | 'assistant' | 'system' | 'tool'

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'openrouter'
  | 'groq'
  | 'custom'

export interface ProviderConfig {
  id: ProviderId
  name: string
  apiKey?: string
  baseURL?: string
  defaultModel: string
  models: ModelInfo[]
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow: number
  maxOutput?: number
  inputCostPer1M?: number
  outputCostPer1M?: number
  supportsTools?: boolean
  supportsVision?: boolean
  supportsStreaming?: boolean
}

export interface Session {
  id: string
  cwd: string
  title?: string
  createdAt: number
  updatedAt: number
  provider: ProviderId
  model: string
  totalTokens: number
  totalCost: number
  messageCount: number
}

export interface Message {
  id: string
  sessionId: string
  role: Role
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  tokens?: number
  cost?: number
  timestamp: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  result?: string
  error?: string
  approved?: boolean
}

export interface TodoItem {
  id: string
  sessionId: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: number
}

export type PermissionMode =
  | 'ask' // Prompt for each tool
  | 'auto' // Auto-approve safe tools, prompt for destructive
  | 'yolo' // Auto-approve everything (dangerous)
  | 'read-only' // Block all write/exec tools

export interface PermissionRule {
  tool: string // e.g. 'bash', 'write', 'bash:rm -rf *'
  action: 'allow' | 'deny' | 'ask'
  scope: 'global' | 'project' | 'session'
}

export interface Config {
  // Core
  defaultProvider: ProviderId
  defaultModel: string
  theme: 'light' | 'dark' | 'auto'
  permissionMode: PermissionMode
  editor?: string

  // Providers
  providers: Partial<Record<ProviderId, ProviderConfig>>

  // Behavior
  autoMemory: boolean
  autoCompactThreshold: number // token count
  streamingEnabled: boolean
  confirmDestructive: boolean

  // Paths
  memoryFile: string // default: ASISTENKU.md
  globalMemoryFile: string // default: ~/.asistenku/ASISTENKU.md
  sessionsDir: string // default: ~/.asistenku/sessions

  // UI
  showTokenCount: boolean
  showCost: boolean
  statusLine: string
  maxScrollback: number

  // Advanced
  mcpServers?: Record<string, McpServerConfig>
  hooks?: HookConfig[]
  skills?: string[] // Paths to skill directories
  agents?: Record<string, AgentConfig>
}

export interface McpServerConfig {
  type: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  disabled?: boolean
}

export interface HookConfig {
  event: 'pre-tool' | 'post-tool' | 'pre-message' | 'post-message' | 'session-start' | 'session-end'
  command: string
  matcher?: string // Tool name pattern
  blocking?: boolean
}

export interface AgentConfig {
  name: string
  description: string
  systemPrompt: string
  tools?: string[] // Allowed tools (whitelist)
  model?: string
  temperature?: number
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: any // Zod schema
  execute: (args: any, context: ToolContext) => Promise<ToolResult>
  dangerous?: boolean // Requires approval even in auto mode
  readonly?: boolean // Safe to run without approval
  category: 'file' | 'shell' | 'search' | 'web' | 'code' | 'memory' | 'custom'
}

export interface ToolContext {
  sessionId: string
  cwd: string
  permissionMode: PermissionMode
  approveCallback: (tool: string, args: any) => Promise<boolean>
  logger?: any
  abort?: AbortSignal
}

export interface ToolResult {
  ok: boolean
  content: string
  metadata?: Record<string, any>
  error?: string
}

export interface StreamEvent {
  type: 'text' | 'tool-call' | 'tool-result' | 'finish' | 'error' | 'thinking'
  data: any
}

export interface ContextStats {
  totalTokens: number
  maxTokens: number
  percentUsed: number
  breakdown: {
    system: number
    memory: number
    messages: number
    tools: number
  }
}
