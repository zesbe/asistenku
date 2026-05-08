/**
 * Permission engine
 *
 * Determines if a tool invocation should be allowed, denied, or prompted
 */

import type { PermissionMode, ToolDefinition } from '../types'
import { getDb } from '../db'

/**
 * Check permission rules first, then fallback to mode-based decision
 */
export function checkPermission(
  tool: ToolDefinition,
  args: any,
  mode: PermissionMode,
  cwd: string
): 'allow' | 'deny' | 'ask' {
  // 1. Check stored rules
  const rule = findRule(tool.name, cwd)
  if (rule) return rule

  // 2. Read-only tools: always allow in any mode except explicit deny
  if (tool.readonly && mode !== 'read-only') return 'allow'

  // 3. Mode-based default
  switch (mode) {
    case 'yolo':
      return 'allow'
    case 'read-only':
      return tool.readonly ? 'allow' : 'deny'
    case 'auto':
      return tool.dangerous ? 'ask' : 'allow'
    case 'ask':
    default:
      return 'ask'
  }
}

interface StoredRule {
  scope: 'global' | 'project'
  tool: string
  action: 'allow' | 'deny'
  projectPath?: string
}

function findRule(toolName: string, cwd: string): 'allow' | 'deny' | null {
  const rows = getDb()
    .query(
      `SELECT * FROM permission_rules 
       WHERE tool = ? 
       AND (scope = 'global' OR (scope = 'project' AND project_path = ?))
       ORDER BY created_at DESC`
    )
    .all(toolName, cwd) as any[]

  if (rows.length === 0) return null
  const rule = rows[0]
  return rule.action === 'deny' ? 'deny' : 'allow'
}

export function savePermissionRule(
  tool: string,
  action: 'allow' | 'deny',
  scope: 'global' | 'project',
  projectPath?: string
) {
  getDb().run(
    `INSERT INTO permission_rules (scope, tool, action, project_path, created_at) VALUES (?, ?, ?, ?, ?)`,
    [scope, tool, action, projectPath || null, Date.now()]
  )
}

export function listPermissionRules(cwd?: string): StoredRule[] {
  const query = cwd
    ? getDb().query(
        `SELECT * FROM permission_rules WHERE scope = 'global' OR project_path = ? ORDER BY scope, tool`
      )
    : getDb().query(`SELECT * FROM permission_rules ORDER BY scope, tool`)
  const rows = cwd ? (query.all(cwd) as any[]) : (query.all() as any[])
  return rows.map((r) => ({
    scope: r.scope,
    tool: r.tool,
    action: r.action,
    projectPath: r.project_path,
  }))
}

export function clearPermissionRules(scope?: 'global' | 'project', cwd?: string) {
  if (scope === 'global') {
    getDb().run(`DELETE FROM permission_rules WHERE scope = 'global'`)
  } else if (scope === 'project' && cwd) {
    getDb().run(`DELETE FROM permission_rules WHERE scope = 'project' AND project_path = ?`, [cwd])
  } else {
    getDb().run(`DELETE FROM permission_rules`)
  }
}
