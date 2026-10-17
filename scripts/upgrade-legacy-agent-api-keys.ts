import 'dotenv/config'
import { db } from '@/lib/db'
import { AgentKeyStorageUpgradeError, upgradePlaintextAgentApiKeys } from '@/lib/agent-key-storage-migration'

// Usage: pnpm run db:upgrade:agent-key-storage [--report-only]
// Prints counts only; never prints key material.
async function main() {
  const reportOnly = process.argv.includes('--report-only')
  const pepperConfigured = Boolean(process.env.AGENT_API_KEY_PEPPER?.trim() || process.env.JWT_SECRET?.trim())
  const result = await upgradePlaintextAgentApiKeys((db as any).$client, {
    pepperConfigured,
    selfTestApiKey: process.env.CLAWDMARKET_SELF_TEST_API_KEY?.trim() || undefined,
    reportOnly,
  })
  console.log(JSON.stringify({ agent_key_storage_upgrade: result }))
  if (result.after.unprefixed_digest > 0) {
    console.log(`::warning::${result.after.unprefixed_digest} agent key(s) may still be stored as unkeyed SHA-256; keep the runtime SHA-256 upgrade path`)
  }
}

main().catch((error) => {
  const code = error instanceof AgentKeyStorageUpgradeError ? error.code : 'unexpected'
  console.error(JSON.stringify({ agent_key_storage_upgrade_error: code, message: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
})
