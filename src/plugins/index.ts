/**
 * Plugin system
 *
 * Plugins are JS/TS modules that extend asistenku with:
 *  - Custom tools
 *  - Custom slash commands
 *  - Custom agents
 *  - Custom skills
 *  - Custom hooks
 *
 * Plugin locations:
 *   ~/.asistenku/plugins/{name}/              ← global
 *   ./.asistenku/plugins/{name}/              ← project
 *   npm packages: @asistenku/plugin-*         ← via install
 *
 * Plugin manifest (plugin.json):
 *   {
 *     "name": "my-plugin",
 *     "version": "1.0.0",
 *     "description": "...",
 *     "entry": "index.js",        // or index.ts
 *     "tools": ["./tools/*.ts"],
 *     "commands": ["./commands/*.ts"],
 *     "agents": ["./agents/*.json"],
 *     "skills": ["./skills/*"]
 *   }
 *
 * Plugin entry file exports:
 *   export default {
 *     activate: (api) => { api.registerTool(...) },
 *     deactivate: () => { ... }
 *   }
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerTool } from '../tools'
import { registerHook } from '../hooks'

const GLOBAL_PLUGINS_DIR = join(homedir(), '.asistenku', 'plugins')

export interface PluginManifest {
  name: string
  version: string
  description?: string
  author?: string
  entry?: string
  tools?: string[]
  commands?: string[]
  agents?: string[]
  skills?: string[]
  dependencies?: Record<string, string>
}

export interface LoadedPlugin {
  manifest: PluginManifest
  path: string
  scope: 'global' | 'project' | 'npm'
  activated: boolean
  error?: string
}

export interface PluginAPI {
  registerTool: typeof registerTool
  registerHook: typeof registerHook
  registerCommand: (cmd: any) => void
  logger: any
}

const loaded: Map<string, LoadedPlugin> = new Map()

/**
 * Discover all plugins
 */
export async function discoverPlugins(cwd: string): Promise<PluginManifest[]> {
  const manifests: PluginManifest[] = []

  const projectDir = join(cwd, '.asistenku', 'plugins')
  if (existsSync(projectDir)) {
    for (const m of await scanPluginsDir(projectDir)) manifests.push(m)
  }

  if (existsSync(GLOBAL_PLUGINS_DIR)) {
    for (const m of await scanPluginsDir(GLOBAL_PLUGINS_DIR)) manifests.push(m)
  }

  return manifests
}

async function scanPluginsDir(dir: string): Promise<PluginManifest[]> {
  const manifests: PluginManifest[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(dir, entry.name, 'plugin.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest: PluginManifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
        manifests.push(manifest)
      } catch {
        // Skip
      }
    }
  } catch {}
  return manifests
}

/**
 * Load (activate) a plugin
 */
export async function loadPlugin(
  pluginPath: string,
  manifest: PluginManifest,
  scope: 'global' | 'project' | 'npm'
): Promise<LoadedPlugin> {
  const loaded: LoadedPlugin = { manifest, path: pluginPath, scope, activated: false }

  try {
    const entryFile = manifest.entry || 'index.js'
    const entryPath = join(pluginPath, entryFile)
    if (!existsSync(entryPath)) {
      // Try index.ts
      const tsPath = join(pluginPath, 'index.ts')
      if (!existsSync(tsPath)) {
        loaded.error = `No entry file: ${entryPath}`
        return loaded
      }
    }

    const mod = await import(entryPath)
    const plugin = mod.default || mod

    if (typeof plugin.activate !== 'function') {
      loaded.error = 'Plugin missing activate() function'
      return loaded
    }

    const api: PluginAPI = {
      registerTool,
      registerHook,
      registerCommand: (cmd: any) => {
        // Add to slash commands registry
        import('../commands/index').then((m) => m.slashCommands.push(cmd))
      },
      logger: console,
    }

    await plugin.activate(api)
    loaded.activated = true
  } catch (err: any) {
    loaded.error = err.message
  }

  return loaded
}

/**
 * Load all discovered plugins
 */
export async function activateAllPlugins(cwd: string): Promise<LoadedPlugin[]> {
  const manifests = await discoverPlugins(cwd)
  const results: LoadedPlugin[] = []

  for (const manifest of manifests) {
    const projectPath = join(cwd, '.asistenku', 'plugins', manifest.name)
    const globalPath = join(GLOBAL_PLUGINS_DIR, manifest.name)
    const path = existsSync(projectPath) ? projectPath : globalPath
    const scope = existsSync(projectPath) ? 'project' : 'global'
    const loadedPlugin = await loadPlugin(path, manifest, scope)
    loaded.set(manifest.name, loadedPlugin)
    results.push(loadedPlugin)
  }

  return results
}

/**
 * Install a plugin from npm or local path
 */
export async function installPlugin(
  source: string,
  opts: { global?: boolean; cwd?: string } = {}
): Promise<{ installed: boolean; path?: string; error?: string }> {
  const { $ } = await import('bun')
  const targetDir = opts.global
    ? GLOBAL_PLUGINS_DIR
    : join(opts.cwd || process.cwd(), '.asistenku', 'plugins')

  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(targetDir, { recursive: true }))

    if (source.startsWith('http') || source.includes('://')) {
      // Git clone
      await $`cd ${targetDir} && git clone ${source}`.quiet()
    } else if (source.startsWith('./') || source.startsWith('/')) {
      // Local path — symlink
      const name = source.split('/').pop()
      await $`ln -sf ${source} ${targetDir}/${name}`.quiet()
    } else {
      // Assume npm package
      await $`cd ${targetDir} && npm install ${source}`.quiet()
    }

    return { installed: true, path: targetDir }
  } catch (err: any) {
    return { installed: false, error: err.message }
  }
}

/**
 * Scaffold plugin skeleton
 */
export async function scaffoldPlugin(
  name: string,
  cwd: string,
  scope: 'project' | 'global' = 'project'
): Promise<{ created: boolean; path: string }> {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const baseDir = scope === 'project' ? join(cwd, '.asistenku', 'plugins') : GLOBAL_PLUGINS_DIR
  const pluginDir = join(baseDir, name)

  if (existsSync(pluginDir)) {
    return { created: false, path: pluginDir }
  }

  await mkdir(pluginDir, { recursive: true })

  const manifest: PluginManifest = {
    name,
    version: '0.1.0',
    description: `${name} plugin for asistenku`,
    entry: 'index.ts',
  }

  await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2))
  await writeFile(
    join(pluginDir, 'index.ts'),
    `/**
 * ${name} plugin for asistenku
 */

import { z } from 'zod'

export default {
  activate(api: any) {
    // Register custom tools
    api.registerTool({
      name: '${name}_hello',
      description: 'Example tool from ${name} plugin',
      category: 'custom',
      parameters: z.object({
        message: z.string(),
      }),
      execute: async ({ message }: any) => {
        return { ok: true, content: \`Hello from ${name}: \${message}\` }
      },
    })

    // Register custom slash command
    api.registerCommand({
      name: '${name}',
      description: '${name} plugin command',
      handler: async () => {
        return { output: 'Plugin ${name} is active!' }
      },
    })
  },

  deactivate() {
    // Cleanup if needed
  },
}
`
  )

  return { created: true, path: pluginDir }
}

export function listLoadedPlugins(): LoadedPlugin[] {
  return Array.from(loaded.values())
}

export { GLOBAL_PLUGINS_DIR }
