/**
 * SQLite persistence layer
 * Auto-saves sessions, messages, todos
 */

import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Session, Message, TodoItem } from '../types'

const DB_DIR = join(homedir(), '.asistenku')
const DB_PATH = join(DB_DIR, 'asistenku.db')

let db: Database | null = null

export function getDb(): Database {
  if (db) return db
  mkdirSync(DB_DIR, { recursive: true })
  db = new Database(DB_PATH, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      total_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      message_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT, -- JSON
      tool_call_id TEXT,
      tokens INTEGER,
      cost REAL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      project_path TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_perms ON permission_rules(scope, tool);
  `)
}

// =============================================================================
// SESSIONS
// =============================================================================

export function createSession(
  partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt' | 'totalTokens' | 'totalCost' | 'messageCount'>
): Session {
  const now = Date.now()
  const id = crypto.randomUUID()
  const session: Session = {
    id,
    ...partial,
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    totalCost: 0,
    messageCount: 0,
  }
  getDb().run(
    `INSERT INTO sessions (id, cwd, title, created_at, updated_at, provider, model, total_tokens, total_cost, message_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.cwd,
      session.title || null,
      session.createdAt,
      session.updatedAt,
      session.provider,
      session.model,
      0,
      0,
      0,
    ]
  )
  return session
}

export function getSession(id: string): Session | null {
  const row = getDb().query(`SELECT * FROM sessions WHERE id = ?`).get(id) as any
  if (!row) return null
  return rowToSession(row)
}

export function listSessions(cwd?: string, limit = 50): Session[] {
  const query = cwd
    ? getDb().query(`SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC LIMIT ?`)
    : getDb().query(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`)
  const rows = cwd ? (query.all(cwd, limit) as any[]) : (query.all(limit) as any[])
  return rows.map(rowToSession)
}

export function updateSession(id: string, updates: Partial<Session>) {
  const current = getSession(id)
  if (!current) return
  const merged = { ...current, ...updates, updatedAt: Date.now() }
  getDb().run(
    `UPDATE sessions SET 
      title = ?, updated_at = ?, provider = ?, model = ?, 
      total_tokens = ?, total_cost = ?, message_count = ?
     WHERE id = ?`,
    [
      merged.title || null,
      merged.updatedAt,
      merged.provider,
      merged.model,
      merged.totalTokens,
      merged.totalCost,
      merged.messageCount,
      id,
    ]
  )
}

export function deleteSession(id: string) {
  getDb().run(`DELETE FROM sessions WHERE id = ?`, [id])
}

// =============================================================================
// MESSAGES
// =============================================================================

export function addMessage(msg: Omit<Message, 'id' | 'timestamp'>): Message {
  const message: Message = {
    id: crypto.randomUUID(),
    ...msg,
    timestamp: Date.now(),
  }
  getDb().run(
    `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, tokens, cost, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolCallId || null,
      message.tokens || null,
      message.cost || null,
      message.timestamp,
    ]
  )
  // Update session stats
  const session = getSession(message.sessionId)
  if (session) {
    updateSession(message.sessionId, {
      messageCount: session.messageCount + 1,
      totalTokens: session.totalTokens + (message.tokens || 0),
      totalCost: session.totalCost + (message.cost || 0),
    })
  }
  return message
}

export function getMessages(sessionId: string, limit?: number): Message[] {
  const query = limit
    ? getDb().query(`SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`)
    : getDb().query(`SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`)
  const rows = limit ? (query.all(sessionId, limit) as any[]).reverse() : (query.all(sessionId) as any[])
  return rows.map(rowToMessage)
}

// =============================================================================
// SETTINGS
// =============================================================================

export function getSetting(key: string): string | null {
  const row = getDb().query(`SELECT value FROM settings WHERE key = ?`).get(key) as any
  return row?.value || null
}

export function setSetting(key: string, value: string) {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, Date.now()]
  )
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToSession(row: any): Session {
  return {
    id: row.id,
    cwd: row.cwd,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    provider: row.provider,
    model: row.model,
    totalTokens: row.total_tokens,
    totalCost: row.total_cost,
    messageCount: row.message_count,
  }
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id,
    tokens: row.tokens,
    cost: row.cost,
    timestamp: row.timestamp,
  }
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
