import { db } from '@/lib/db'

let ensured = false

export async function ensurePaymentRailColumn() {
  if (ensured) return
  const client = (db as any)?.$client
  if (!client?.execute) { ensured = true; return }

  try {
    await client.execute("ALTER TABLE trades ADD COLUMN payment_rail TEXT NOT NULL DEFAULT 'ledger'")
  } catch {
    // column already exists
  }

  ensured = true
}
