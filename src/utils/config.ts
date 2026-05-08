/**
 * Config loader
 * Priority (highest to lowest):
 *   1. env vars
 *   2. project: ./asistenku.config.json or .asistenku/config.json
 *   3. global: ~/.asistenku/config.json
 *   4. defaults
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import dotenv from 'dotenv'
const loadEnv = (opts?: any) => dotenv.config({ ...opts, quiet: true })
import type { Config, ProviderId } from '../types'

const GLOBAL_CONFIG_DIR = join(homedir(), '.asistenku')
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json')
const PROJECT_CONFIG_NAMES = ['.asistenku/config.json', 'asistenku.config.json']

// Load .env file
loadEnv()
loadEnv({ path: join(GLOBAL_CONFIG_DIR, '.env') })

export const DEFAULT_CONFIG: Config = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-5-20250929',
  theme: 'auto',
  permissionMode: 'ask',
  providers: {},
  autoMemory: false,
  autoCompactThreshold: 150_000,
  streamingEnabled: true,
  confirmDestructive: true,
  memoryFile: 'ASISTENKU.md',
  globalMemoryFile: join(GLOBAL_CONFIG_DIR, 'ASISTENKU.md'),
  sessionsDir: join(GLOBAL_CONFIG_DIR, 'sessions'),
  showTokenCount: true,
  showCost: true,
  statusLine: '{provider}/{model} | {tokens} tokens | ${cost}',
  maxScrollback: 1000,
}

/**
 * Load config by merging default + global + project + env
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  let config: Config = { ...DEFAULT_CONFIG }

  // Global
  if (existsSync(GLOBAL_CONFIG_FILE)) {
    try {
      const global = JSON.parse(await readFile(GLOBAL_CONFIG_FILE, 'utf-8'))
      config = deepMerge(config, global)
    } catch (err) {
      console.warn('Failed to load global config:', err)
    }
  }

  // Project
  for (const name of PROJECT_CONFIG_NAMES) {
    const path = join(cwd, name)
    if (existsSync(path)) {
      try {
        const project = JSON.parse(await readFile(path, 'utf-8'))
        config = deepMerge(config, project)
        break
      } catch (err) {
        console.warn(`Failed to load project config ${name}:`, err)
      }
    }
  }

  // Env overrides
  if (process.env.ASISTENKU_PROVIDER) {
    config.defaultProvider = process.env.ASISTENKU_PROVIDER as ProviderId
  }
  if (process.env.ASISTENKU_MODEL) {
    config.defaultModel = process.env.ASISTENKU_MODEL
  }
  if (process.env.ASISTENKU_PERMISSION_MODE) {
    config.permissionMode = process.env.ASISTENKU_PERMISSION_MODE as any
  }

  // Auto-populate provider API keys from env
  const envProviders: Array<[ProviderId, string]> = [
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['google', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    ['google', 'GEMINI_API_KEY'],
    ['deepseek', 'DEEPSEEK_API_KEY'],
    ['groq', 'GROQ_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY'],
  ]

  for (const [provider, envVar] of envProviders) {
    const key = process.env[envVar]
    if (key && !config.providers[provider]?.apiKey) {
      config.providers[provider] = {
        id: provider,
        name: provider,
        apiKey: key,
        defaultModel: '',
        models: [],
        ...config.providers[provider],
      }
    }
  }

  return config
}

export async function saveGlobalConfig(config: Partial<Config>) {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true })
  const existing = existsSync(GLOBAL_CONFIG_FILE)
    ? JSON.parse(await readFile(GLOBAL_CONFIG_FILE, 'utf-8'))
    : {}
  const merged = deepMerge(existing, config)
  await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8')
}

export async function saveProjectConfig(cwd: string, config: Partial<Config>) {
  const path = join(cwd, 'asistenku.config.json')
  const existing = existsSync(path) ? JSON.parse(await readFile(path, 'utf-8')) : {}
  const merged = deepMerge(existing, config)
  await writeFile(path, JSON.stringify(merged, null, 2), 'utf-8')
}

function deepMerge<T>(target: T, source: any): T {
  const result: any = Array.isArray(target) ? [...(target as any)] : { ...target }
  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      result[key] &&
      typeof result[key] === 'object'
    ) {
      result[key] = deepMerge(result[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result as T
}

export { GLOBAL_CONFIG_FILE, GLOBAL_CONFIG_DIR }
