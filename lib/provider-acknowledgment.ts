import { sql } from 'drizzle-orm'
import { service_execution_attempts } from '@/lib/schema'

export const PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS = 600

/** Legacy writes during rollback retain their original deadline rather than gaining time. */
export const providerAcknowledgmentDueSql = sql<number>`COALESCE(${service_execution_attempts.acknowledgment_due_at}, ${service_execution_attempts.created_at} + ${PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS})`

export function providerAcknowledgmentDueAt(attempt: Pick<typeof service_execution_attempts.$inferSelect, 'acknowledgment_due_at' | 'created_at'>) {
  return attempt.acknowledgment_due_at || new Date(attempt.created_at.getTime() + PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS * 1000)
}
