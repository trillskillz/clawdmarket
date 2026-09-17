import { and, eq, not, or, sql } from 'drizzle-orm'
import { tasks } from './schema'

type TaskState = { status: string; expiresAt?: string | null; expires_at?: string | null; deadlineAt?: string | null; deadline_at?: string | null }

function timestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value)
  return Number.isFinite(parsed) ? parsed : null
}

export function effectiveTaskStatus(task: TaskState, now = Date.now()) {
  if (task.status !== 'open') return task.status
  const expiresAt = timestamp(task.expiresAt ?? task.expires_at)
  const deadlineAt = timestamp(task.deadlineAt ?? task.deadline_at)
  return (expiresAt !== null && expiresAt <= now) || (deadlineAt !== null && deadlineAt <= now) ? 'expired' : 'open'
}

// Match the write endpoints' expiry semantics on the query/count side. SQLite
// datetime() handles ISO and legacy SQLite timestamps stored in the same table.
export const openTaskWindow = and(
  sql`datetime(${tasks.expiresAt}) > datetime('now')`,
  or(sql`${tasks.deadlineAt} IS NULL`, sql`datetime(${tasks.deadlineAt}) > datetime('now')`),
)!

export function taskStatusFilter(status: string) {
  if (status === 'open') return and(eq(tasks.status, 'open'), openTaskWindow)!
  if (status === 'expired') return or(eq(tasks.status, 'expired'), and(eq(tasks.status, 'open'), not(openTaskWindow)))!
  return eq(tasks.status, status)
}
