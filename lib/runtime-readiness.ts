import 'server-only'
import { inspectDatabaseSchema, type DatabaseReadiness } from '@/lib/database-readiness'
import { logger } from '@/lib/logger'
import { getPaymentReadiness } from '@/lib/payment-config'

type RuntimeEnvironment = Record<string, string | undefined>

export type RuntimeConfigurationReadiness = {
  ready: boolean
  enforced: boolean
  missing: string[]
}

export function requiresProductionReadiness(env: RuntimeEnvironment = process.env) {
  if (env.NEXT_PHASE === 'phase-production-build') return false
  return env.VERCEL_ENV === 'production' || env.CLAWDMARKET_PRODUCTION_READINESS === 'true'
}

export function inspectRuntimeConfiguration(env: RuntimeEnvironment = process.env): RuntimeConfigurationReadiness {
  const enforced = requiresProductionReadiness(env)
  if (!enforced) return { ready: true, enforced: false, missing: [] }

  const required = [
    'TURSO_DATABASE_URL',
    'JWT_SECRET',
    'CHAT_ENCRYPTION_KEY',
    'WEBHOOK_SECRET_KEY',
    'CRON_SECRET',
  ]
  const databaseUrl = env.TURSO_DATABASE_URL?.trim() || ''
  if (databaseUrl && !databaseUrl.startsWith('file:')) required.push('TURSO_AUTH_TOKEN')

  const missing = required.filter((name) => !env[name]?.trim())
  return { ready: missing.length === 0, enforced, missing }
}

type PaymentReadinessSummary = {
  ready: boolean
  required: boolean
  enabled_rails: Array<'ledger' | 'mpp' | 'evm'>
  disabled_rails: Array<'ledger' | 'mpp' | 'evm'>
  error?: 'invalid_payment_configuration'
}

type DatabaseReadinessSummary = DatabaseReadiness & {
  checked: boolean
  error?: 'configuration_missing' | 'connection_or_schema_check_failed'
}

export type RuntimeReadiness = {
  ready: boolean
  configuration: RuntimeConfigurationReadiness
  database: DatabaseReadinessSummary
  payments: PaymentReadinessSummary
  password_reset_email: { configured: boolean }
}

const READY_CACHE_MS = 30_000
const NOT_READY_CACHE_MS = 5_000
let cachedReadiness: { value: RuntimeReadiness; expiresAt: number } | null = null
let readinessInFlight: Promise<RuntimeReadiness> | null = null

function unreadyDatabase(error: DatabaseReadinessSummary['error']): DatabaseReadinessSummary {
  return {
    ready: false,
    checked: false,
    latency_ms: 0,
    missing_tables: [],
    missing_columns: [],
    error,
  }
}

async function computeRuntimeReadiness(): Promise<RuntimeReadiness> {
  const configuration = inspectRuntimeConfiguration()
  let database = unreadyDatabase('configuration_missing')

  const databaseConfigMissing = configuration.missing.some((name) =>
    name === 'TURSO_DATABASE_URL' || name === 'TURSO_AUTH_TOKEN',
  )
  if (!databaseConfigMissing) {
    try {
      const { db } = await import('@/lib/db')
      database = { ...(await inspectDatabaseSchema(db.$client)), checked: true }
    } catch (error) {
      logger.error('Runtime readiness database check failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      database = {
        ...unreadyDatabase('connection_or_schema_check_failed'),
        checked: true,
      }
    }
  }

  const enabledRails: PaymentReadinessSummary['enabled_rails'] = []
  const settlementReadyRails: PaymentReadinessSummary['enabled_rails'] = []
  let paymentError: PaymentReadinessSummary['error']
  try {
    const readiness = getPaymentReadiness()
    if (readiness.ledger.enabled) {
      enabledRails.push('ledger')
      if (readiness.ledger.redeemable) settlementReadyRails.push('ledger')
    }
    if (readiness.mpp.enabled) {
      enabledRails.push('mpp')
      settlementReadyRails.push('mpp')
    }
    if (readiness.evm.enabled) {
      enabledRails.push('evm')
      settlementReadyRails.push('evm')
    }
  } catch (error) {
    paymentError = 'invalid_payment_configuration'
    logger.error('Runtime readiness payment configuration check failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const allRails: PaymentReadinessSummary['enabled_rails'] = ['ledger', 'mpp', 'evm']
  const payments: PaymentReadinessSummary = {
    // A non-redeemable internal balance is useful for testing, but it is not a
    // production payment rail and must not make a deployment look payable.
    ready: settlementReadyRails.length > 0,
    required: configuration.enforced,
    enabled_rails: enabledRails,
    disabled_rails: allRails.filter((rail) => !enabledRails.includes(rail)),
    ...(paymentError ? { error: paymentError } : {}),
  }
  const passwordResetEmailConfigured = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.PASSWORD_RESET_FROM_EMAIL?.trim(),
  )

  return {
    ready: configuration.ready && database.ready && (!payments.required || payments.ready),
    configuration,
    database,
    payments,
    password_reset_email: { configured: passwordResetEmailConfigured },
  }
}

/**
 * Coalesce concurrent probes and briefly cache the result. Load balancer polls
 * should not turn a read-only schema audit into dozens of database round trips
 * every second, while failures still need to become visible quickly.
 */
export async function inspectRuntimeReadiness(): Promise<RuntimeReadiness> {
  const now = Date.now()
  if (cachedReadiness && cachedReadiness.expiresAt > now) return cachedReadiness.value
  if (readinessInFlight) return readinessInFlight

  readinessInFlight = computeRuntimeReadiness()
    .then((value) => {
      cachedReadiness = {
        value,
        expiresAt: Date.now() + (value.ready ? READY_CACHE_MS : NOT_READY_CACHE_MS),
      }
      return value
    })
    .finally(() => {
      readinessInFlight = null
    })

  return readinessInFlight
}
