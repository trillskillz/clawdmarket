import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { parse } from 'dotenv'

const config = parse(readFileSync('.vercel/.env.production.local'))
const url = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()
const adminIds = (config.ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
const adminEmail = (config.ADMIN_LOGIN_EMAIL || '').trim().toLowerCase()

if (!url || url.startsWith('file:') || !authToken) {
  throw new Error('A remote production database URL and token are required')
}
if (!adminIds.length || !adminEmail) {
  throw new Error('Production admin login email and ID must be configured before auditing')
}

const client = createClient({ url, authToken })

try {
  const admin = await client.execute({
    sql: 'SELECT id, email FROM users WHERE LOWER(email) = ?',
    args: [adminEmail],
  })
  if (admin.rows.length !== 1 || !adminIds.includes(admin.rows[0].id)) {
    throw new Error('Admin login email does not resolve to the configured admin user ID')
  }

  const summary = await client.execute(`
    SELECT COUNT(*) AS wallet_count,
      SUM(CASE WHEN balance > 0.000001 THEN 1 ELSE 0 END) AS positive_balance_count,
      SUM(CASE WHEN escrow > 0.000001 THEN 1 ELSE 0 END) AS positive_escrow_count,
      ROUND(SUM(balance), 2) AS total_balance,
      ROUND(SUM(escrow), 2) AS total_escrow
    FROM wallets
  `)
  const funded = await client.execute(`
    SELECT w.user_id, u.role, w.balance, w.escrow,
      (SELECT COUNT(*) FROM transactions t WHERE t.from_user_id = w.user_id OR t.to_user_id = w.user_id) AS transaction_count,
      (SELECT COUNT(*) FROM trades t WHERE t.buyer_id = w.user_id AND t.payment_rail = 'ledger' AND t.status IN ('escrow_held', 'pending_release', 'disputed')) AS active_ledger_trades
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE ABS(w.balance) > 0.000001 OR ABS(w.escrow) > 0.000001
    ORDER BY w.balance DESC, w.user_id
  `)

  console.log('Internal credit audit:', JSON.stringify(summary.rows[0]))
  const groups = new Map()
  for (const row of funded.rows) {
    const accountType = row.user_id === admin.rows[0].id ? 'admin_login' : row.user_id === 'system_marketplace_fees' ? 'marketplace_fees' : row.role
    const current = groups.get(accountType) || { account_type: accountType, funded_wallets: 0, total_balance: 0, total_escrow: 0, transaction_count: 0, active_ledger_trades: 0 }
    current.funded_wallets += 1
    current.total_balance += Number(row.balance)
    current.total_escrow += Number(row.escrow)
    current.transaction_count += Number(row.transaction_count)
    current.active_ledger_trades += Number(row.active_ledger_trades)
    groups.set(accountType, current)
  }
  for (const group of groups.values()) {
    group.total_balance = Math.round(group.total_balance * 100) / 100
    group.total_escrow = Math.round(group.total_escrow * 100) / 100
    console.log('Balance group:', JSON.stringify(group))
  }
  console.log('Non-admin funded wallets:', funded.rows.filter((row) => row.user_id !== admin.rows[0].id).length)
} finally {
  client.close()
}
