import 'server-only'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { db } from './db'
import * as schema from './schema'

export function isLocalSqliteContention(error: unknown) {
  let cause = error
  for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
    if ('message' in cause && /SQLITE_BUSY|database is locked/i.test(String(cause.message))) return true
    cause = 'cause' in cause ? cause.cause : null
  }
  return false
}

/** Read-only inspection; never put a financial callback inside this retry. */
export async function readWithLocalContentionRecovery<T>(read: (source: typeof db) => PromiseLike<T>): Promise<T> {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  if (!url?.startsWith('file:') || url.startsWith('file::memory:')) return await read(db)
  for (let attempt = 0; attempt < 6; attempt++) {
    let client: ReturnType<typeof createClient> | undefined
    try {
      client = createClient({ url })
      return await read(drizzle(client, { schema }))
    }
    catch (error) {
      if (!isLocalSqliteContention(error) || attempt === 5) throw error
    } finally { client?.close() }
    await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
  }
  throw new Error('local_sqlite_read_unavailable')
}
