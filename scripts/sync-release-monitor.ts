import 'dotenv/config'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'
import { createHmac } from 'node:crypto'

const MONITOR_AGENT_ID = 'agent_clawdmarket_release_monitor'
const MONITOR_USER_ID = `user_agent_${MONITOR_AGENT_ID}`
const MONITOR_WALLET_ID = `wallet_${MONITOR_AGENT_ID}`

async function main() {
  const databaseUrl = process.env.TURSO_DATABASE_URL?.trim()
  const databaseToken = process.env.TURSO_AUTH_TOKEN?.trim()
  const apiKey = process.env.CLAWDMARKET_SELF_TEST_API_KEY?.trim()
  const apiKeyPepper = process.env.AGENT_API_KEY_PEPPER?.trim() || process.env.JWT_SECRET?.trim()
  if (!databaseUrl) {
    throw new Error('TURSO_DATABASE_URL is required to sync the release monitor')
  }
  if (!databaseUrl.startsWith('file:') && !databaseToken) {
    throw new Error('TURSO_AUTH_TOKEN is required for a remote release-monitor sync')
  }
  if (!apiKey || apiKey.length < 32) {
    throw new Error('CLAWDMARKET_SELF_TEST_API_KEY must be a high-entropy key of at least 32 characters')
  }
  if (!apiKeyPepper) {
    throw new Error('AGENT_API_KEY_PEPPER or JWT_SECRET is required to sync the release monitor')
  }

  const client = createClient({ url: databaseUrl, authToken: databaseToken })
  const now = new Date().toISOString()
  const nowEpoch = Math.floor(Date.now() / 1000)
  // This is a high-entropy bearer token, not a human password; keyed HMAC is
  // required to match the indexed runtime credential digest.
  // codeql[js/insufficient-password-hash]
  const apiKeyHash = createHmac('sha256', apiKeyPepper)
    .update(`agent-api-key:${apiKey}`)
    .digest('hex')
  const noninteractivePasswordHash = await bcrypt.hash(apiKey, 12)
  try {
    await client.batch([
      {
        sql: `INSERT INTO users (id, email, password_hash, name, role, created_at)
              VALUES (?, ?, ?, ?, 'agent', ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
        args: [
          MONITOR_USER_ID,
          'release-monitor@agent.clawdmkt.com',
          noninteractivePasswordHash,
          'ClawdMarket Release Monitor',
          nowEpoch,
        ],
      },
      {
        sql: `INSERT INTO wallets (id, user_id, balance, escrow, created_at)
              VALUES (?, ?, 0, 0, ?)
              ON CONFLICT(user_id) DO NOTHING`,
        args: [MONITOR_WALLET_ID, MONITOR_USER_ID, nowEpoch],
      },
      {
        sql: `INSERT INTO agents (
                id, name, description, capabilities, endpoint, owner_address,
                owner_email, api_key, status, created_at, version, base_agent_id,
                tools_config, benchmark_history, claim_code, claimed_at, is_online
              ) VALUES (?, ?, ?, ?, ?, '', ?, ?, 'active', ?, 1, ?, '[]', '[]', NULL, ?, 0)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                capabilities = excluded.capabilities,
                endpoint = excluded.endpoint,
                owner_email = excluded.owner_email,
                api_key = excluded.api_key,
                status = 'active',
                claimed_at = COALESCE(agents.claimed_at, excluded.claimed_at)`,
        args: [
          MONITOR_AGENT_ID,
          'ClawdMarket Release Monitor',
          'Internal non-selling identity used to verify authenticated agent access after production deployments.',
          '["monitoring","testing","deployment"]',
          'https://www.clawdmkt.com/api/health',
          'health@clawdmkt.com',
          apiKeyHash,
          nowEpoch,
          MONITOR_AGENT_ID,
          now,
        ],
      },
    ], 'write')
    console.log(`Release monitor synchronized: ${MONITOR_AGENT_ID}`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error('Release monitor synchronization failed:', error)
  process.exit(1)
})
