/**
 * Multi-provider AI adapter
 * Supports: Anthropic, OpenAI, Google, DeepSeek, Ollama, OpenRouter, Groq, Custom
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createDeepSeek } from '@ai-sdk/deepseek'
import type { LanguageModel } from 'ai'
import type { ProviderId, ModelInfo, Config } from '../types'

/**
 * Built-in model catalog with pricing (USD per 1M tokens)
 * Update periodically from provider docs
 */
export const MODEL_CATALOG: Record<ProviderId, ModelInfo[]> = {
  anthropic: [
    {
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5',
      contextWindow: 200_000,
      maxOutput: 64_000,
      inputCostPer1M: 3,
      outputCostPer1M: 15,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
    {
      id: 'claude-opus-4-1-20250805',
      name: 'Claude Opus 4.1',
      contextWindow: 200_000,
      maxOutput: 32_000,
      inputCostPer1M: 15,
      outputCostPer1M: 75,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
    {
      id: 'claude-3-5-haiku-20241022',
      name: 'Claude 3.5 Haiku',
      contextWindow: 200_000,
      maxOutput: 8_192,
      inputCostPer1M: 0.8,
      outputCostPer1M: 4,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
  ],
  openai: [
    {
      id: 'gpt-5',
      name: 'GPT-5',
      contextWindow: 256_000,
      maxOutput: 32_000,
      inputCostPer1M: 5,
      outputCostPer1M: 20,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
    {
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      contextWindow: 128_000,
      maxOutput: 16_384,
      inputCostPer1M: 2.5,
      outputCostPer1M: 10,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
    {
      id: 'o3-mini',
      name: 'o3-mini (reasoning)',
      contextWindow: 200_000,
      maxOutput: 100_000,
      inputCostPer1M: 1.1,
      outputCostPer1M: 4.4,
      supportsTools: true,
      supportsStreaming: true,
    },
  ],
  google: [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      contextWindow: 2_000_000,
      maxOutput: 8_192,
      inputCostPer1M: 1.25,
      outputCostPer1M: 5,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      contextWindow: 1_000_000,
      maxOutput: 8_192,
      inputCostPer1M: 0.075,
      outputCostPer1M: 0.3,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
    },
  ],
  deepseek: [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek V3',
      contextWindow: 64_000,
      maxOutput: 8_192,
      inputCostPer1M: 0.27,
      outputCostPer1M: 1.1,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek R1 (reasoning)',
      contextWindow: 64_000,
      maxOutput: 8_192,
      inputCostPer1M: 0.55,
      outputCostPer1M: 2.19,
      supportsTools: true,
      supportsStreaming: true,
    },
  ],
  ollama: [
    {
      id: 'llama3.3:70b',
      name: 'Llama 3.3 70B (local)',
      contextWindow: 128_000,
      maxOutput: 4_096,
      inputCostPer1M: 0,
      outputCostPer1M: 0,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'qwen2.5-coder:32b',
      name: 'Qwen 2.5 Coder 32B (local)',
      contextWindow: 128_000,
      maxOutput: 4_096,
      inputCostPer1M: 0,
      outputCostPer1M: 0,
      supportsTools: true,
      supportsStreaming: true,
    },
  ],
  openrouter: [],
  groq: [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B (Groq)',
      contextWindow: 128_000,
      maxOutput: 8_192,
      inputCostPer1M: 0.59,
      outputCostPer1M: 0.79,
      supportsTools: true,
      supportsStreaming: true,
    },
  ],
  custom: [],
}

/**
 * Load provider and return LanguageModel
 */
export function getModel(provider: ProviderId, modelId: string, config: Config): LanguageModel {
  const providerConfig = config.providers[provider]

  switch (provider) {
    case 'anthropic': {
      const apiKey = providerConfig?.apiKey || process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
      const client = createAnthropic({ apiKey, baseURL: providerConfig?.baseURL })
      return client(modelId)
    }
    case 'openai': {
      const apiKey = providerConfig?.apiKey || process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY not set')
      const client = createOpenAI({ apiKey, baseURL: providerConfig?.baseURL })
      return client(modelId)
    }
    case 'google': {
      const apiKey =
        providerConfig?.apiKey ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set')
      const client = createGoogleGenerativeAI({ apiKey, baseURL: providerConfig?.baseURL })
      return client(modelId)
    }
    case 'deepseek': {
      const apiKey = providerConfig?.apiKey || process.env.DEEPSEEK_API_KEY
      if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')
      const client = createDeepSeek({ apiKey })
      return client(modelId)
    }
    case 'ollama': {
      // Ollama uses OpenAI-compatible API
      const baseURL = providerConfig?.baseURL || 'http://localhost:11434/v1'
      const client = createOpenAI({
        apiKey: 'ollama', // Placeholder, not used by Ollama
        baseURL,
      })
      return client(modelId)
    }
    case 'openrouter': {
      const apiKey = providerConfig?.apiKey || process.env.OPENROUTER_API_KEY
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')
      const client = createOpenAI({
        apiKey,
        baseURL: providerConfig?.baseURL || 'https://openrouter.ai/api/v1',
      })
      return client(modelId)
    }
    case 'groq': {
      const apiKey = providerConfig?.apiKey || process.env.GROQ_API_KEY
      if (!apiKey) throw new Error('GROQ_API_KEY not set')
      const client = createOpenAI({
        apiKey,
        baseURL: 'https://api.groq.com/openai/v1',
      })
      return client(modelId)
    }
    case 'custom': {
      if (!providerConfig?.baseURL) throw new Error('Custom provider requires baseURL')
      const client = createOpenAI({
        apiKey: providerConfig.apiKey || 'custom',
        baseURL: providerConfig.baseURL,
      })
      return client(modelId)
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

/**
 * List all available providers based on env/config
 */
export function availableProviders(config: Config): ProviderId[] {
  const available: ProviderId[] = []

  if (config.providers.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY)
    available.push('anthropic')
  if (config.providers.openai?.apiKey || process.env.OPENAI_API_KEY) available.push('openai')
  if (config.providers.google?.apiKey || process.env.GEMINI_API_KEY) available.push('google')
  if (config.providers.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY) available.push('deepseek')
  if (config.providers.openrouter?.apiKey || process.env.OPENROUTER_API_KEY)
    available.push('openrouter')
  if (config.providers.groq?.apiKey || process.env.GROQ_API_KEY) available.push('groq')

  // Ollama assumed available if running locally
  available.push('ollama')

  return available
}

/**
 * Resolve model info from provider + id
 */
export function getModelInfo(provider: ProviderId, modelId: string): ModelInfo | null {
  const list = MODEL_CATALOG[provider] || []
  return list.find((m) => m.id === modelId) || null
}

/**
 * Calculate cost given tokens
 */
export function calculateCost(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const info = getModelInfo(provider, modelId)
  if (!info) return 0
  const inputCost = ((info.inputCostPer1M || 0) * inputTokens) / 1_000_000
  const outputCost = ((info.outputCostPer1M || 0) * outputTokens) / 1_000_000
  return inputCost + outputCost
}
