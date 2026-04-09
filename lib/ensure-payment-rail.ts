import { db } from '@/lib/db'

let ensured = false

export async function ensurePaymentRailColumn() {
  if (ensured) return
  const client = (db as any)?.$client
  if (!client?.execute) { ensured = true; return }

  try {
    await client.execute("ALTER TABLE trades ADD COLUMN payment_rail TEXT DEFAULT 'mpp'")
  } catch {
    // column already exists
  }

  // Backfill existing completed trades to 'mpp' (all seed trades used MPP)
  try {
    await client.execute("UPDATE trades SET payment_rail = 'mpp' WHERE status = 'completed' AND payment_rail IS NULL")
  } catch {
    // no-op
  }

  ensured = true
}
