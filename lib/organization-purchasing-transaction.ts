import 'server-only'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { db } from './db'
import * as schema from './schema'

export type PurchasingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type PurchasingSource = PurchasingTransaction | typeof db
export class PurchasingError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}

function contention(error: unknown) {
  for (let depth = 0; error && depth < 6; depth++) {
    if (typeof error !== 'object') return false
    if ('message' in error && /SQLITE_BUSY|database is locked|UNIQUE constraint failed: (organization_purchasing_roles|organization_purchase_requests|organization_purchase_approvals|organization_purchase_uses)\./i.test(String(error.message))) return true
    error = 'cause' in error ? error.cause : null
  }
  return false
}

/** Each failed write gets a fresh client; existing financial transactions keep their pool. */
export async function purchasingTransaction<T>(write: (tx: PurchasingTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL?.trim() || 'file:./local.db', authToken: process.env.TURSO_AUTH_TOKEN })
    try { return await drizzle(client, { schema }).transaction(write) }
    catch (error) {
      if (!contention(error)) throw error
      if (attempt === 5) throw new PurchasingError('PURCHASING_STORAGE_BUSY', 503)
    } finally { client.close() }
    await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
  }
  throw new PurchasingError('PURCHASING_STORAGE_BUSY', 503)
}
