import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { createClient } from '@libsql/client'
import { MARKETPLACE_COHORTS } from '../lib/marketplace-cohort-policy'

// Explicit operator records only. Never infer cohort from names, descriptions,
// account counts, email domain or absence from the reference-fleet manifest.
const record = z.object({ principal_id: z.string().min(1).max(200), cohort: z.enum(MARKETPLACE_COHORTS),
  owner_group: z.string().min(1).max(200).nullable().default(null), evidence_ref: z.string().min(1).max(1000),
  recorded_by: z.string().min(1).max(200), expires_at: z.string().datetime().nullable().default(null) }).strict()
async function main() {
const path = process.argv[2]
if (!path || path.startsWith('--')) throw new Error('Usage: import-marketplace-cohorts.ts reviewed-records.json [--apply-local]')
const records = z.array(record).min(1).max(1000).parse(JSON.parse(await readFile(path, 'utf8')))
for (const row of records) {
  if (row.cohort === 'independence_verified' && (!row.owner_group || !row.expires_at
    || Date.parse(row.expires_at) <= Date.now() || Date.parse(row.expires_at) > Date.now() + 90 * 86_400_000)) throw new Error('Independence attribution requires a reviewed owner group and a future expiry within 90 days')
}
if (!process.argv.includes('--apply-local')) {
  console.log(JSON.stringify({ dry_run: true, records: records.length, cohorts: records.reduce((counts, row) => ({ ...counts, [row.cohort]: (counts[row.cohort] || 0) + 1 }), {} as Record<string, number>) }))
} else {
  const url = process.env.TURSO_DATABASE_URL || ''
  if (!url.startsWith('file:')) throw new Error('This local-only importer cannot write a remote database. Production attribution needs separate publication authorization.')
  const client = createClient({ url })
  try {
    await client.batch(records.map(row => ({ sql: 'INSERT INTO marketplace_cohort_attributions (id, principal_id, cohort, owner_group, evidence_ref, recorded_by, recorded_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [crypto.randomUUID(), row.principal_id, row.cohort, row.owner_group, row.evidence_ref, row.recorded_by, new Date().toISOString(), row.expires_at] })), 'write')
    console.log(JSON.stringify({ imported: records.length }))
  } finally { client.close() }
}
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
