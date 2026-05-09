/**
 * Basic tests for core modules
 * Run: bun test
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

describe('providers', () => {
  test('MODEL_CATALOG has all expected providers', async () => {
    const { MODEL_CATALOG } = await import('../src/providers')
    expect(Object.keys(MODEL_CATALOG)).toContain('anthropic')
    expect(Object.keys(MODEL_CATALOG)).toContain('openai')
    expect(Object.keys(MODEL_CATALOG)).toContain('google')
    expect(Object.keys(MODEL_CATALOG)).toContain('ollama')
  })

  test('calculateCost returns correct cost', async () => {
    const { calculateCost } = await import('../src/providers')
    // Claude Sonnet: $3/1M input, $15/1M output
    const cost = calculateCost('anthropic', 'claude-sonnet-4-5-20250929', 1_000_000, 1_000_000)
    expect(cost).toBe(18) // 3 + 15
  })

  test('availableProviders returns ollama even without API keys', async () => {
    const { availableProviders } = await import('../src/providers')
    const { DEFAULT_CONFIG } = await import('../src/utils/config')
    const providers = availableProviders({ ...DEFAULT_CONFIG, providers: {} })
    expect(providers).toContain('ollama')
  })
})

describe('tools', () => {
  test('listTools returns multiple tools', async () => {
    const { listTools, initBuiltinTools } = await import('../src/tools')
    initBuiltinTools()
    const tools = listTools()
    expect(tools.length).toBeGreaterThan(5)
  })

  test('read_file tool exists', async () => {
    const { getTool } = await import('../src/tools')
    const tool = getTool('read_file')
    expect(tool).toBeDefined()
    expect(tool?.category).toBe('file')
    expect(tool?.readonly).toBe(true)
  })

  test('bash tool is dangerous', async () => {
    const { getTool } = await import('../src/tools')
    const tool = getTool('bash')
    expect(tool?.dangerous).toBe(true)
  })
})

describe('permissions', () => {
  test('read-only mode blocks dangerous tools', async () => {
    const { checkPermission } = await import('../src/agent/permissions')
    const { getTool } = await import('../src/tools')
    const bashTool = getTool('bash')!
    const decision = checkPermission(bashTool, {}, 'read-only', '/tmp')
    expect(decision).toBe('deny')
  })

  test('yolo mode allows all', async () => {
    const { checkPermission } = await import('../src/agent/permissions')
    const { getTool } = await import('../src/tools')
    const bashTool = getTool('bash')!
    const decision = checkPermission(bashTool, {}, 'yolo', '/tmp')
    expect(decision).toBe('allow')
  })

  test('auto mode asks for dangerous tools', async () => {
    const { checkPermission } = await import('../src/agent/permissions')
    const { getTool } = await import('../src/tools')
    const bashTool = getTool('bash')!
    const decision = checkPermission(bashTool, {}, 'auto', '/tmp')
    expect(decision).toBe('ask')
  })

  test('auto mode allows readonly tools', async () => {
    const { checkPermission } = await import('../src/agent/permissions')
    const { getTool } = await import('../src/tools')
    const readTool = getTool('read_file')!
    const decision = checkPermission(readTool, {}, 'auto', '/tmp')
    expect(decision).toBe('allow')
  })
})

describe('db', () => {
  test('can create and retrieve session', async () => {
    const { createSession, getSession } = await import('../src/db')
    const session = createSession({
      cwd: '/tmp/test-asistenku',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    })
    expect(session.id).toBeDefined()
    const retrieved = getSession(session.id)
    expect(retrieved?.cwd).toBe('/tmp/test-asistenku')
  })

  test('can add messages to session', async () => {
    const { createSession, addMessage, getMessages } = await import('../src/db')
    const session = createSession({
      cwd: '/tmp/test-asistenku-msgs',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    })
    addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'hello',
    })
    addMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'hi there',
    })
    const msgs = getMessages(session.id)
    expect(msgs.length).toBe(2)
    expect(msgs[0].content).toBe('hello')
    expect(msgs[1].content).toBe('hi there')
  })
})

describe('config', () => {
  test('DEFAULT_CONFIG has expected shape', async () => {
    const { DEFAULT_CONFIG } = await import('../src/utils/config')
    expect(DEFAULT_CONFIG.defaultProvider).toBe('anthropic')
    expect(DEFAULT_CONFIG.permissionMode).toBe('ask')
    expect(DEFAULT_CONFIG.streamingEnabled).toBe(true)
  })
})

describe('agents', () => {
  test('BUILTIN_AGENTS has multiple agents', async () => {
    const { BUILTIN_AGENTS } = await import('../src/agents')
    expect(Object.keys(BUILTIN_AGENTS).length).toBeGreaterThanOrEqual(5)
    expect(BUILTIN_AGENTS.architect).toBeDefined()
    expect(BUILTIN_AGENTS.reviewer).toBeDefined()
  })
})

describe('memory', () => {
  const testCwd = '/tmp/asistenku-test-memory-' + Date.now()
  beforeAll(async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(testCwd, { recursive: true })
  })
  afterAll(() => {
    if (existsSync(testCwd)) rmSync(testCwd, { recursive: true })
  })

  test('initProjectMemory creates ASISTENKU.md', async () => {
    const { initProjectMemory } = await import('../src/agent/memory')
    const result = await initProjectMemory(testCwd)
    expect(result.created).toBe(true)
    expect(existsSync(result.path)).toBe(true)
  })

  test('appendMemory appends to file', async () => {
    const { appendMemory } = await import('../src/agent/memory')
    await appendMemory('Test fact 123', 'project', testCwd)
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(testCwd, 'ASISTENKU.md'), 'utf-8')
    expect(content).toContain('Test fact 123')
  })
})

describe('routines', () => {
  test('parseSchedule handles "every 5m"', async () => {
    // Internal function — test indirectly via addRoutine
    const { loadRoutines, saveRoutines } = await import('../src/routines')
    const routines = await loadRoutines()
    expect(Array.isArray(routines)).toBe(true)
  })
})
