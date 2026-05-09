/**
 * Web UI — simple dashboard for sessions + config
 *
 * Serves a minimal HTML page at http://localhost:{port}/ that shows:
 *   - Active sessions list
 *   - Recent messages
 *   - Config viewer
 *   - Cost + token stats
 *   - Routines management
 *
 * Accessed via `asistenku serve --port 3300`
 */

import { listSessions, getMessages, getSession } from '../db'
import { loadConfig } from '../utils/config'
import { loadRoutines } from '../routines'
import { discoverAgents } from '../agents'
import { discoverSkills } from '../skills'

const HTML_PAGE = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>asistenku dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      line-height: 1.6;
    }
    header {
      background: linear-gradient(135deg, #1e3a8a, #0e7490);
      padding: 1.5rem 2rem;
      box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.8rem; }
    .subtitle { color: #a3a3a3; font-size: 0.9rem; margin-top: 4px; }
    main { padding: 2rem; max-width: 1400px; margin: 0 auto; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 1.5rem;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 1.5rem;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #0e7490; }
    .card h2 {
      font-size: 1.1rem;
      margin-bottom: 1rem;
      color: #22d3ee;
    }
    .stat {
      font-size: 2rem;
      color: #fbbf24;
      font-weight: bold;
    }
    .session-item {
      padding: 0.75rem;
      background: #0f0f0f;
      border-radius: 8px;
      margin-bottom: 0.5rem;
      border-left: 3px solid #22d3ee;
    }
    .session-id { font-size: 0.8rem; color: #6b7280; font-family: monospace; }
    .session-meta { font-size: 0.85rem; color: #9ca3af; }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      margin-right: 0.5rem;
    }
    .badge-green { background: #065f46; color: #a7f3d0; }
    .badge-yellow { background: #78350f; color: #fde68a; }
    .loading { text-align: center; padding: 2rem; color: #6b7280; }
    .refresh { float: right; cursor: pointer; color: #22d3ee; }
  </style>
</head>
<body>
  <header>
    <h1>⚡ asistenku</h1>
    <div class="subtitle">Dashboard — multi-provider AI coding CLI</div>
  </header>
  <main>
    <div class="grid">
      <div class="card">
        <h2>📊 Stats <span class="refresh" onclick="load()">↻</span></h2>
        <div id="stats" class="loading">Loading...</div>
      </div>
      <div class="card">
        <h2>💬 Recent Sessions</h2>
        <div id="sessions" class="loading">Loading...</div>
      </div>
      <div class="card">
        <h2>🤖 Agents</h2>
        <div id="agents" class="loading">Loading...</div>
      </div>
      <div class="card">
        <h2>📚 Skills</h2>
        <div id="skills" class="loading">Loading...</div>
      </div>
      <div class="card">
        <h2>🗓️  Routines</h2>
        <div id="routines" class="loading">Loading...</div>
      </div>
      <div class="card">
        <h2>⚙ Config</h2>
        <div id="config" class="loading">Loading...</div>
      </div>
    </div>
  </main>
  <script>
    async function load() {
      const data = await fetch('/api/dashboard').then(r => r.json())
      document.getElementById('stats').innerHTML = \`
        <div>Total sessions: <span class="stat">\${data.stats.sessionCount}</span></div>
        <div>Messages: <span class="stat">\${data.stats.messageCount}</span></div>
        <div>Tokens used: <span class="stat">\${data.stats.totalTokens.toLocaleString()}</span></div>
        <div>Total cost: <span class="stat">$\${data.stats.totalCost.toFixed(4)}</span></div>
      \`
      document.getElementById('sessions').innerHTML = data.sessions.slice(0, 5).map(s =>
        \`<div class="session-item">
          <div>\${s.title || '(untitled)'}</div>
          <div class="session-id">\${s.id.substring(0,8)}</div>
          <div class="session-meta">
            <span class="badge badge-green">\${s.messageCount} msgs</span>
            <span class="badge badge-yellow">\${s.provider}/\${s.model}</span>
            $\${s.totalCost.toFixed(4)}
          </div>
        </div>\`
      ).join('') || '(no sessions)'

      document.getElementById('agents').innerHTML = data.agents.map(a =>
        \`<div>• <b>\${a.name}</b> [\${a.scope || 'builtin'}] — \${a.description}</div>\`
      ).join('') || '(no agents)'

      document.getElementById('skills').innerHTML = data.skills.map(s =>
        \`<div>• <b>\${s.name}</b> [\${s.scope}] — \${s.description || ''}</div>\`
      ).join('') || '(no skills)'

      document.getElementById('routines').innerHTML = data.routines.map(r =>
        \`<div>
          \${r.enabled ? '✓' : '✗'} <b>\${r.name}</b> — \${r.schedule}
          <div class="session-meta">runs: \${r.runCount}, \${r.lastRun ? new Date(r.lastRun).toLocaleString() : 'never'}</div>
         </div>\`
      ).join('') || '(no routines)'

      document.getElementById('config').innerHTML = \`
        <div>Default: \${data.config.defaultProvider}/\${data.config.defaultModel}</div>
        <div>Permission mode: \${data.config.permissionMode}</div>
        <div>Theme: \${data.config.theme}</div>
        <div>Providers: \${data.config.availableProviders.join(', ')}</div>
      \`
    }
    load()
    setInterval(load, 5000)
  </script>
</body>
</html>`

export interface WebUIOptions {
  port: number
  host?: string
  auth?: string // Optional token
}

export async function startWebUI(opts: WebUIOptions) {
  const server = Bun.serve({
    port: opts.port,
    hostname: opts.host || '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)

      // Auth check
      if (opts.auth) {
        const token = req.headers.get('x-asistenku-token') || url.searchParams.get('token')
        if (token !== opts.auth) {
          return new Response('Unauthorized', { status: 401 })
        }
      }

      // Routes
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(HTML_PAGE, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (url.pathname === '/api/dashboard') {
        const config = await loadConfig()
        const sessions = listSessions(undefined, 50)
        const routines = await loadRoutines()
        const agents = await discoverAgents(process.cwd())
        const skills = await discoverSkills(process.cwd())
        const { availableProviders } = await import('../providers')
        const { BUILTIN_AGENTS } = await import('../agents')

        const allAgents = [...Object.values(BUILTIN_AGENTS), ...agents]

        const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0)
        const totalCost = sessions.reduce((sum, s) => sum + s.totalCost, 0)
        const messageCount = sessions.reduce((sum, s) => sum + s.messageCount, 0)

        return Response.json({
          stats: {
            sessionCount: sessions.length,
            messageCount,
            totalTokens,
            totalCost,
          },
          sessions,
          agents: allAgents.map((a) => ({
            name: a.name,
            description: a.description,
            scope: (a as any).scope,
          })),
          skills,
          routines,
          config: {
            defaultProvider: config.defaultProvider,
            defaultModel: config.defaultModel,
            permissionMode: config.permissionMode,
            theme: config.theme,
            availableProviders: availableProviders(config),
          },
        })
      }

      if (url.pathname.startsWith('/api/session/')) {
        const id = url.pathname.split('/')[3]
        const session = getSession(id)
        if (!session) return new Response('Not found', { status: 404 })
        const messages = getMessages(id)
        return Response.json({ session, messages })
      }

      return new Response('Not found', { status: 404 })
    },
  })

  console.log(`🌐 Web UI running at http://${opts.host || '127.0.0.1'}:${opts.port}`)
  if (opts.auth) console.log(`🔐 Auth token: ${opts.auth}`)
  return server
}
