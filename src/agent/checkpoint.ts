/**
 * Checkpointing — rewind code changes + conversation state
 *
 * Before any destructive tool (write_file, edit_file, delete_file, bash),
 * we snapshot:
 *   1. Current content of files that will be modified
 *   2. Conversation state (message count, last message id)
 *
 * /rewind allows restoring to a previous checkpoint.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db'

const CHECKPOINT_DIR = join(homedir(), '.asistenku', 'checkpoints')

export interface Checkpoint {
  id: string
  sessionId: string
  timestamp: number
  description: string
  files: CheckpointFile[]
  messageCount: number
  messageIdBefore?: string
}

export interface CheckpointFile {
  path: string
  originalContent: string | null // null if file didn't exist
  action: 'create' | 'modify' | 'delete'
}

/**
 * Initialize checkpoint table
 */
function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      description TEXT NOT NULL,
      files_json TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      message_id_before TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, timestamp DESC);
  `)
}

/**
 * Create a checkpoint before a destructive operation
 */
export async function createCheckpoint(
  sessionId: string,
  description: string,
  filePaths: string[],
  messageIdBefore?: string
): Promise<Checkpoint> {
  ensureTable()
  await mkdir(CHECKPOINT_DIR, { recursive: true })

  const id = crypto.randomUUID()
  const files: CheckpointFile[] = []

  for (const path of filePaths) {
    try {
      const content = existsSync(path) ? await readFile(path, 'utf-8') : null
      files.push({
        path,
        originalContent: content,
        action: content === null ? 'create' : 'modify',
      })
    } catch (err) {
      // Skip unreadable files
    }
  }

  const messageCountRow = getDb()
    .query(`SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?`)
    .get(sessionId) as any

  const checkpoint: Checkpoint = {
    id,
    sessionId,
    timestamp: Date.now(),
    description,
    files,
    messageCount: messageCountRow?.cnt || 0,
    messageIdBefore,
  }

  getDb().run(
    `INSERT INTO checkpoints (id, session_id, timestamp, description, files_json, message_count, message_id_before)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      checkpoint.id,
      checkpoint.sessionId,
      checkpoint.timestamp,
      checkpoint.description,
      JSON.stringify(checkpoint.files),
      checkpoint.messageCount,
      checkpoint.messageIdBefore || null,
    ]
  )

  return checkpoint
}

/**
 * List checkpoints for a session
 */
export function listCheckpoints(sessionId: string, limit = 20): Checkpoint[] {
  ensureTable()
  const rows = getDb()
    .query(
      `SELECT * FROM checkpoints WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`
    )
    .all(sessionId, limit) as any[]

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    timestamp: r.timestamp,
    description: r.description,
    files: JSON.parse(r.files_json),
    messageCount: r.message_count,
    messageIdBefore: r.message_id_before,
  }))
}

export function getCheckpoint(id: string): Checkpoint | null {
  ensureTable()
  const row = getDb().query(`SELECT * FROM checkpoints WHERE id = ?`).get(id) as any
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    description: row.description,
    files: JSON.parse(row.files_json),
    messageCount: row.message_count,
    messageIdBefore: row.message_id_before,
  }
}

/**
 * Restore checkpoint — undo file changes
 */
export async function restoreCheckpoint(
  id: string,
  opts: { files?: boolean; conversation?: boolean } = { files: true, conversation: true }
): Promise<{ restoredFiles: number; truncatedMessages: number }> {
  const cp = getCheckpoint(id)
  if (!cp) throw new Error(`Checkpoint ${id} not found`)

  let restoredFiles = 0
  let truncatedMessages = 0

  if (opts.files !== false) {
    for (const file of cp.files) {
      try {
        if (file.originalContent === null) {
          // File didn't exist before → delete it now
          if (existsSync(file.path)) {
            await rm(file.path, { force: true })
            restoredFiles++
          }
        } else {
          await writeFile(file.path, file.originalContent, 'utf-8')
          restoredFiles++
        }
      } catch (err) {
        // Skip failures
      }
    }
  }

  if (opts.conversation !== false) {
    // Truncate messages after checkpoint
    const result = getDb().run(
      `DELETE FROM messages WHERE session_id = ? AND id != ? 
       AND id NOT IN (
         SELECT id FROM messages WHERE session_id = ? ORDER BY timestamp LIMIT ?
       )`,
      [cp.sessionId, cp.messageIdBefore || '', cp.sessionId, cp.messageCount]
    )
    truncatedMessages = result.changes
  }

  return { restoredFiles, truncatedMessages }
}

/**
 * Clean up old checkpoints (keep last N per session)
 */
export function cleanupOldCheckpoints(sessionId: string, keep = 50) {
  ensureTable()
  const all = listCheckpoints(sessionId, 1000)
  const toDelete = all.slice(keep)
  if (!toDelete.length) return 0
  const ids = toDelete.map((c) => c.id)
  const placeholders = ids.map(() => '?').join(',')
  getDb().run(`DELETE FROM checkpoints WHERE id IN (${placeholders})`, ids)
  return toDelete.length
}

export { CHECKPOINT_DIR }
