/**
 * Todo list management for sessions
 */

import { getDb } from './index'
import type { TodoItem } from '../types'

export function addTodo(sessionId: string, content: string): TodoItem {
  const todo: TodoItem = {
    id: crypto.randomUUID(),
    sessionId,
    content,
    status: 'pending',
    createdAt: Date.now(),
  }
  getDb().run(
    `INSERT INTO todos (id, session_id, content, status, created_at) VALUES (?, ?, ?, ?, ?)`,
    [todo.id, todo.sessionId, todo.content, todo.status, todo.createdAt]
  )
  return todo
}

export function listTodos(sessionId: string): TodoItem[] {
  const rows = getDb()
    .query(`SELECT * FROM todos WHERE session_id = ? ORDER BY created_at`)
    .all(sessionId) as any[]
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
  }))
}

export function completeTodo(id: string) {
  getDb().run(`UPDATE todos SET status = 'completed' WHERE id = ?`, [id])
}

export function removeTodo(id: string) {
  getDb().run(`DELETE FROM todos WHERE id = ?`, [id])
}

export async function manageTodo(
  sessionId: string,
  action: 'add' | 'list' | 'complete' | 'remove',
  { content, id }: { content?: string; id?: string }
): Promise<string> {
  switch (action) {
    case 'add':
      if (!content) return 'Error: content required'
      const todo = addTodo(sessionId, content)
      return `✓ Added todo: ${todo.content} (${todo.id.substring(0, 8)})`

    case 'list':
      const todos = listTodos(sessionId)
      if (!todos.length) return 'No todos'
      return todos
        .map(
          (t) =>
            `${t.status === 'completed' ? '[x]' : '[ ]'} ${t.content} (${t.id.substring(0, 8)})`
        )
        .join('\n')

    case 'complete':
      if (!id) return 'Error: id required'
      completeTodo(id)
      return `✓ Completed todo ${id}`

    case 'remove':
      if (!id) return 'Error: id required'
      removeTodo(id)
      return `✓ Removed todo ${id}`

    default:
      return `Error: unknown action ${action}`
  }
}
