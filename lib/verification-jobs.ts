import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, gt, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { private_artifacts, service_definitions, service_orders, trades, verification_jobs } from './schema'
import { ArtifactError, artifactMetadata, authorizeArtifactTrade, loadDeliveryArtifacts } from './private-artifacts'
import { decryptArtifact, encryptArtifact } from './artifact-crypto'
import { canonicalContract } from './structured-verification'
import { isolatedCheckPolicySchema, isolatedTestSuiteSchema } from './isolated-check-policy'
import { isolatedVerifierEligibility } from './isolated-verifier-eligibility'
import { serviceExecutionContract } from './service-execution-contract'
import { verificationPolicySchema, type VerificationPolicy, type VerificationResult } from './verification-policy'
import { withKeyedWriteLock } from './service-reservation-lock'
import { VERIFIER_ADAPTERS, verifierArtifactExtension } from '../scripts/verifier-contract.mjs'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Job = typeof verification_jobs.$inferSelect
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export class VerificationJobError extends Error {
  constructor(public code: string, public status: number) { super(code) }
}
const requestSchema = z.object({ client_reference: z.string().min(8).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  artifact_id: z.uuid(), test_suite: isolatedTestSuiteSchema,
}).strict()
export const isolatedReportSchema = z.object({ version: z.literal(1), adapter: z.enum(VERIFIER_ADAPTERS),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/), suite_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['passed', 'failed']), total_checks: z.number().int().min(1).max(20), passed_checks: z.number().int().min(0).max(20), failed_checks: z.number().int().min(0).max(20),
  elapsed_ms: z.number().int().min(0).max(35_000), failure: z.enum(['checks_failed', 'timeout', 'sandbox_failed', 'resource_limit']).nullable(),
  isolation: z.object({ kind: z.literal('bwrap-systemd-v1'), network_enabled: z.literal(false), host_home_mounted: z.literal(false),
    memory_limit_bytes: z.literal(134_217_728), task_limit: z.literal(32) }).strict(),
}).strict().refine((report) => report.total_checks === report.passed_checks + report.failed_checks
  && (report.status === 'passed' ? report.failed_checks === 0 && report.failure === null : report.failed_checks > 0 && report.failure !== null), 'Report totals and status must agree')

function metadata(job: Job) {
  return { id: job.id, trade_id: job.trade_id, verifier_agent_id: job.verifier_agent_id, artifact_id: job.artifact_id,
    artifact_sha256: job.artifact_sha256, request_hash: job.request_hash, policy: JSON.parse(job.policy_json),
    state: job.state, created_at: job.created_at, expires_at: job.expires_at, completed_at: job.completed_at,
    report: job.report_json ? JSON.parse(job.report_json) : null, report_hash: job.report_hash,
    provenance: { kind: 'buyer_approved_authenticated_verifier', isolation_observed_by_app: false, semantic_verified: false } }
}
async function agreement(tradeId: string, source: Source) {
  const [linked] = await source.select({ execution_contract_json: service_orders.execution_contract_json, verification_policy: service_definitions.verification_policy })
    .from(service_orders).innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id)).where(eq(service_orders.trade_id, tradeId)).limit(1)
  if (!linked || !linked.execution_contract_json) throw new VerificationJobError('VERIFICATION_CONTRACT_REQUIRED', 409)
  try {
    const policy = verificationPolicySchema.parse(JSON.parse(serviceExecutionContract(linked, linked).verification_policy))
    if (!policy.isolated_checks) throw new Error('Missing isolated contract')
    return policy.isolated_checks
  } catch { throw new VerificationJobError('VERIFICATION_CONTRACT_REQUIRED', 409) }
}
async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run() } catch (error) {
      let cause: unknown = error, busy = false
      for (let depth = 0; cause && depth < 6; depth++) {
        if (typeof cause !== 'object') break
        if ('code' in cause && String(cause.code).startsWith('SQLITE_BUSY') || 'message' in cause && /SQLITE_BUSY|database is locked/i.test(String(cause.message))) busy = true
        cause = 'cause' in cause ? cause.cause : null
      }
      if (!busy) throw error
      if (attempt >= 5) throw new VerificationJobError('VERIFICATION_STORAGE_BUSY', 503)
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

export async function createVerificationJob(tradeId: string, buyerId: string, input: unknown) {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) throw new VerificationJobError('VERIFICATION_JOB_INVALID', 400)
  const data = parsed.data, id = crypto.randomUUID()
  const requestHash = hash(canonicalContract(data)), suiteHash = hash(canonicalContract(data.test_suite))
  const encrypted = await encryptArtifact(JSON.stringify({ kind: 'verification-suite-v1', id, tradeId, suite: data.test_suite }))
  return withKeyedWriteLock(`delivery:${tradeId}`, () => retry(() => db.transaction(async (tx) => {
    const trade = await authorizeArtifactTrade(tradeId, buyerId, tx)
    if (trade.buyer_id !== buyerId) throw new VerificationJobError('VERIFICATION_BUYER_REQUIRED', 403)
    const [prior] = await tx.select().from(verification_jobs).where(and(eq(verification_jobs.trade_id, tradeId), eq(verification_jobs.client_reference, data.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== requestHash) throw new VerificationJobError('VERIFICATION_REFERENCE_CONFLICT', 409)
      return { job: metadata(prior), idempotent: true }
    }
    if (trade.status !== 'escrow_held') throw new VerificationJobError('VERIFICATION_WORK_NOT_ACTIVE', 409)
    const config = await agreement(tradeId, tx)
    if (suiteHash !== config.suite_sha256 || config.adapter === 'javascript_static_v1' && data.test_suite.cases.length !== 1) throw new VerificationJobError('VERIFICATION_SUITE_MISMATCH', 422)
    const reason = await isolatedVerifierEligibility(config, trade.buyer_id, trade.seller_id, tx)
    if (reason) throw new VerificationJobError(reason, 409)
    const priorJobs = await tx.select({ id: verification_jobs.id }).from(verification_jobs).where(eq(verification_jobs.trade_id, tradeId))
    if (priorJobs.length >= 8) throw new VerificationJobError('VERIFICATION_JOB_LIMIT', 413)
    const [{ row }] = await loadDeliveryArtifacts(tradeId, [data.artifact_id], trade.status, tx)
    if (row.media_type !== 'text/plain' || !row.name.endsWith(verifierArtifactExtension(config.adapter))) throw new VerificationJobError('VERIFICATION_CODE_MEDIA_INVALID', 400)
    const now = new Date()
    const [job] = await tx.insert(verification_jobs).values({ id, trade_id: tradeId, buyer_id: buyerId, verifier_agent_id: config.verifier_agent_id,
      artifact_id: row.id, artifact_sha256: row.sha256, client_reference: data.client_reference, request_hash: requestHash,
      policy_json: JSON.stringify(config), case_count: data.test_suite.cases.length, suite_ciphertext: encrypted.ciphertext, suite_nonce: encrypted.nonce,
      created_at: now, expires_at: new Date(now.getTime() + 600_000) }).returning()
    return { job: metadata(job), idempotent: false }
  })))
}

async function authorizeJob(jobId: string, userId: string, source: Source = db) {
  const [job] = await source.select().from(verification_jobs).where(eq(verification_jobs.id, jobId)).limit(1)
  const [trade] = job ? await source.select().from(trades).where(eq(trades.id, job.trade_id)).limit(1) : []
  const verifier = job && userId === `user_agent_${job.verifier_agent_id}`
  if (!job || !trade || !verifier && ![trade.buyer_id, trade.seller_id].includes(userId)) throw new VerificationJobError('VERIFICATION_JOB_NOT_FOUND', 404)
  return { job, trade, verifier }
}
async function assertActiveVerifier(job: Job, trade: typeof trades.$inferSelect, source: Source = db) {
  if (job.state !== 'pending' || job.expires_at <= new Date() || trade.status !== 'escrow_held') throw new VerificationJobError('VERIFICATION_GRANT_INACTIVE', 409)
  const config = isolatedCheckPolicySchema.parse(JSON.parse(job.policy_json))
  const reason = await isolatedVerifierEligibility(config, trade.buyer_id, trade.seller_id, source)
  if (reason) throw new VerificationJobError(reason, 409)
}
export async function getVerificationJob(jobId: string, userId: string) {
  const { job, trade, verifier } = await authorizeJob(jobId, userId)
  if (!verifier) return { job: metadata(job) }
  // Successful response recovery uses the immutable metadata/receipt, not a renewed private grant.
  if (job.state !== 'pending') return { job: metadata(job) }
  await assertActiveVerifier(job, trade)
  if (!job.suite_ciphertext || !job.suite_nonce) throw new VerificationJobError('VERIFICATION_SUITE_UNAVAILABLE', 409)
  const binding = JSON.parse(await decryptArtifact(job.suite_ciphertext, job.suite_nonce))
  const suite = isolatedTestSuiteSchema.parse(binding.suite)
  if (binding.kind !== 'verification-suite-v1' || binding.id !== job.id || binding.tradeId !== job.trade_id
    || hash(canonicalContract(suite)) !== JSON.parse(job.policy_json).suite_sha256) throw new VerificationJobError('VERIFICATION_SUITE_UNAVAILABLE', 409)
  return { job: metadata(job), test_suite: suite, artifact_path: `/api/verification-jobs/${job.id}/artifact`, report_path: `/api/verification-jobs/${job.id}` }
}
export async function downloadVerificationArtifact(jobId: string, userId: string) {
  const { job, trade, verifier } = await authorizeJob(jobId, userId)
  if (!verifier) throw new VerificationJobError('VERIFICATION_VERIFIER_REQUIRED', 403)
  await assertActiveVerifier(job, trade)
  const [{ row, bytes }] = await loadDeliveryArtifacts(trade.id, [job.artifact_id], trade.status)
  if (row.sha256 !== job.artifact_sha256) throw new ArtifactError('ARTIFACT_INTEGRITY_FAILED', 422)
  return { bytes, artifact: artifactMetadata(row, trade.status) }
}
export async function submitVerificationReport(jobId: string, userId: string, input: unknown) {
  const parsed = isolatedReportSchema.safeParse(input)
  if (!parsed.success) throw new VerificationJobError('VERIFICATION_REPORT_INVALID', 400)
  const report = parsed.data, reportHash = hash(canonicalContract(report))
  const initial = await authorizeJob(jobId, userId)
  if (!initial.verifier) throw new VerificationJobError('VERIFICATION_VERIFIER_REQUIRED', 403)
  return withKeyedWriteLock(`delivery:${initial.trade.id}`, () => retry(() => db.transaction(async (tx) => {
    const { job, trade } = await authorizeJob(jobId, userId, tx)
    if (job.report_hash) {
      if (job.report_hash !== reportHash) throw new VerificationJobError('VERIFICATION_REPORT_CONFLICT', 409)
      return { job: metadata(job), idempotent: true }
    }
    await assertActiveVerifier(job, trade, tx)
    const config = isolatedCheckPolicySchema.parse(JSON.parse(job.policy_json))
    if (report.adapter !== config.adapter || report.artifact_sha256 !== job.artifact_sha256 || report.suite_sha256 !== config.suite_sha256
      || report.total_checks !== job.case_count || report.elapsed_ms > config.max_runtime_seconds * 1000 + 5000) throw new VerificationJobError('VERIFICATION_REPORT_BINDING_MISMATCH', 422)
    const [{ row }] = await loadDeliveryArtifacts(trade.id, [job.artifact_id], trade.status, tx)
    if (row.sha256 !== job.artifact_sha256) throw new ArtifactError('ARTIFACT_INTEGRITY_FAILED', 422)
    const [saved] = await tx.update(verification_jobs).set({ state: report.status, report_json: JSON.stringify(report), report_hash: reportHash,
      suite_ciphertext: null, suite_nonce: null, completed_at: new Date() }).where(and(eq(verification_jobs.id, jobId), eq(verification_jobs.state, 'pending'), gt(verification_jobs.expires_at, new Date()))).returning()
    if (!saved) throw new VerificationJobError('VERIFICATION_GRANT_INACTIVE', 409)
    return { job: metadata(saved), idempotent: false }
  })))
}
export async function cancelVerificationJob(jobId: string, buyerId: string) {
  const initial = await authorizeJob(jobId, buyerId)
  return withKeyedWriteLock(`delivery:${initial.trade.id}`, () => retry(() => db.transaction(async (tx) => {
    const { job, trade } = await authorizeJob(jobId, buyerId, tx)
    if (buyerId !== trade.buyer_id) throw new VerificationJobError('VERIFICATION_BUYER_REQUIRED', 403)
    if (job.state === 'cancelled') return { job: metadata(job), idempotent: true }
    if (trade.status !== 'escrow_held') throw new VerificationJobError('VERIFICATION_WORK_NOT_ACTIVE', 409)
    const [saved] = await tx.update(verification_jobs).set({ state: 'cancelled', suite_ciphertext: null, suite_nonce: null, completed_at: new Date() }).where(eq(verification_jobs.id, jobId)).returning()
    return { job: metadata(saved), idempotent: false }
  })))
}
export async function expireVerificationJobs(limit = 100) {
  return retry(() => db.transaction(async (tx) => {
    const rows = await tx.select({ id: verification_jobs.id }).from(verification_jobs).where(and(eq(verification_jobs.state, 'pending'), lte(verification_jobs.expires_at, new Date()))).limit(Math.max(1, Math.min(100, limit)))
    if (!rows.length) return 0
    return (await tx.update(verification_jobs).set({ state: 'expired', suite_ciphertext: null, suite_nonce: null, completed_at: new Date() })
      .where(and(inArray(verification_jobs.id, rows.map((row) => row.id)), eq(verification_jobs.state, 'pending'))).returning({ id: verification_jobs.id })).length
  }))
}

export async function verifyIsolatedDelivery(tradeId: string, artifactIds: string[], jobId: string | undefined, policy: VerificationPolicy, source: Source = db): Promise<VerificationResult | null> {
  if (!policy.isolated_checks) {
    if (jobId) throw new VerificationJobError('VERIFICATION_CONTRACT_REQUIRED', 409)
    return null
  }
  const [job] = jobId ? await source.select().from(verification_jobs).where(and(eq(verification_jobs.id, jobId), eq(verification_jobs.trade_id, tradeId))).limit(1) : []
  const [trade] = await source.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  const eligible = trade && !await isolatedVerifierEligibility(policy.isolated_checks, trade.buyer_id, trade.seller_id, source)
  const report = isolatedReportSchema.safeParse(job?.report_json ? JSON.parse(job.report_json) : null)
  const [artifact] = job ? await source.select({ sha256: private_artifacts.sha256 }).from(private_artifacts).where(and(eq(private_artifacts.id, job.artifact_id), eq(private_artifacts.trade_id, tradeId))).limit(1) : []
  const passed = Boolean(eligible && job && job.state === 'passed' && job.report_hash && artifactIds.includes(job.artifact_id)
    && artifact?.sha256 === job.artifact_sha256 && report.success && report.data.status === 'passed' && report.data.artifact_sha256 === job.artifact_sha256
    && report.data.suite_sha256 === policy.isolated_checks.suite_sha256 && report.data.adapter === policy.isolated_checks.adapter
    && report.data.total_checks === job.case_count && hash(canonicalContract(report.data)) === job.report_hash
    && canonicalContract(JSON.parse(job.policy_json)) === canonicalContract(policy.isolated_checks))
  return { method: 'isolated_checks', verifier: 'buyer-approved-verifier-v1', version: '1', status: passed ? 'passed' : 'failed', score: passed ? 1 : 0,
    evidence: { job_id: job?.id ?? null, artifact_sha256: job?.artifact_sha256 ?? null, suite_sha256: policy.isolated_checks.suite_sha256,
      adapter: policy.isolated_checks.adapter, verifier_agent_id: policy.isolated_checks.verifier_agent_id, report_hash: job?.report_hash ?? null,
      authenticated_verifier: Boolean(job?.report_hash), isolation_observed_by_app: false, semantic_verified: false, buyer_independence: 'not_verified' },
    failure: passed ? null : 'isolated_checks_validation_failed' }
}
