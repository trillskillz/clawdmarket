import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, benchmark_definitions, benchmark_runs } from './schema'
import { encryptArtifact, decryptArtifact } from './artifact-crypto'
import { canonicalContract } from './structured-verification'
import { normalizeCapability } from './capabilities'
import { peerBenchmarkParticipantsEligible } from './peer-benchmarks'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { withKeyedWriteLock } from './service-reservation-lock'
import { TRUSTED_BENCHMARK_EVIDENCE } from './benchmark-evidence'
export { TRUSTED_BENCHMARK_EVIDENCE } from './benchmark-evidence'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Definition = typeof benchmark_definitions.$inferSelect
type Run = typeof benchmark_runs.$inferSelect
export type BenchmarkReader = { agentId?: string; ownerId?: string }
const digest = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const cases = z.array(z.object({ id: identifier, input: z.json(), expected: z.json() }).strict()).min(1).max(20)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length)
export const benchmarkDefinitionInput = z.object({ suite_key: identifier, version: z.number().int().min(1).max(1_000_000),
  title: z.string().trim().min(5).max(100), capability_id: z.string().max(80).refine((value) => normalizeCapability(value) === value),
  grader_agent_id: z.string().min(1).max(200), adapter: z.literal('json_exact_v1'), cases,
}).strict()
const createInput = z.object({ definition_id: z.uuid(), client_reference: z.uuid() }).strict()
export const benchmarkSubmissionInput = z.object({ outputs: z.array(z.object({ id: identifier, output: z.json() }).strict()).min(1).max(20)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length) }).strict()
export const benchmarkReportInput = z.object({ version: z.literal(1), adapter: z.literal('json_exact_v1'),
  definition_hash: sha, submission_hash: sha, cases: z.array(z.object({ id: identifier, passed: z.boolean() }).strict()).min(1).max(20)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length) }).strict()
export class TrustedBenchmarkError extends Error {
  constructor(public code: string, public status: number) { super(code) }
}
function fail(code: string, status = 409): never { throw new TrustedBenchmarkError(code, status) }
const unfinished = ['awaiting_submission', 'awaiting_grading'] as const
function configuredGraders() {
  const raw = process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS || ''
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean)
  return raw.length <= 4096 && ids.length <= 20 && ids.every((id) => /^[a-zA-Z0-9_-]{1,200}$/.test(id)) ? ids : []
}
async function graderEligible(id: string, source: Source) {
  if (!configuredGraders().includes(id)) return false
  const [agent] = await source.select().from(agents).where(eq(agents.id, id)).limit(1)
  return !!agent && agent.status === 'active' && !agent.archivedAt && !agent.description.includes(REFERENCE_FLEET_MARKER)
}
async function participantHash(target: string, grader: string, source: Source) {
  const owners = await source.select({ agent: agent_owners.agentId, owner: agent_owners.userId }).from(agent_owners)
    .where(inArray(agent_owners.agentId, [target, grader]))
  return digest({ target, grader, owners: owners.sort((a, b) => compare(canonicalContract(a), canonicalContract(b))) })
}
async function durable<T>(key: string, action: () => Promise<T>): Promise<T> {
  return withKeyedWriteLock(`trusted-benchmark:${key}`, async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await action() } catch (error) {
        let cause: unknown = error, busy = false
        for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
          if ('code' in cause && String(cause.code).startsWith('SQLITE_BUSY') || 'message' in cause && /SQLITE_BUSY|database is locked/i.test(String(cause.message))) busy = true
          cause = 'cause' in cause ? cause.cause : null
        }
        if (!busy) throw error
        if (attempt >= 5) fail('BENCHMARK_STORAGE_BUSY', 503)
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  })
}
export function definitionMetadata(row: Definition) {
  return { id: row.id, suite_key: row.suite_key, version: row.version, title: row.title,
    capability_id: row.capability_id, grader_agent_id: row.grader_agent_id, adapter: 'json_exact_v1',
    definition_hash: row.definition_hash, case_count: row.case_count, status: row.status, created_at: row.created_at,
    evidence: TRUSTED_BENCHMARK_EVIDENCE }
}
function runMetadata(row: Run, definition: Definition) {
  return { id: row.id, definition: definitionMetadata(definition), definition_hash: row.definition_hash,
    target_agent_id: row.target_agent_id, grader_agent_id: row.grader_agent_id, state: row.state,
    submission_hash: row.submission_hash, report_hash: row.report_hash, created_at: row.created_at,
    expires_at: row.expires_at, completed_at: row.completed_at,
    observation: row.state === 'graded' ? { passed_count: row.passed_count, total_count: definition.case_count,
      exact_match_percent: Math.round(row.passed_count! / definition.case_count * 10_000) / 100 } : null,
    evidence: TRUSTED_BENCHMARK_EVIDENCE }
}
async function privateDefinition(row: Definition) {
  try {
    const payload = JSON.parse(await decryptArtifact(row.ciphertext, row.nonce))
    const data = benchmarkDefinitionInput.parse(payload.definition)
    if (payload.kind !== 'benchmark-definition-v1' || payload.id !== row.id || !/^[a-f0-9]{64}$/.test(payload.salt)
      || digest(payload) !== row.definition_hash || digest(data) !== row.request_hash
      || data.suite_key !== row.suite_key || data.version !== row.version || data.title !== row.title
      || data.capability_id !== row.capability_id || data.grader_agent_id !== row.grader_agent_id || data.cases.length !== row.case_count) throw new Error('Binding')
    return data
  } catch { fail('BENCHMARK_MATERIAL_INTEGRITY', 422) }
}
async function privateSubmission(run: Run) {
  try {
    if (!run.submission_ciphertext || !run.submission_nonce) throw new Error('Missing')
    const payload = JSON.parse(await decryptArtifact(run.submission_ciphertext, run.submission_nonce))
    const data = benchmarkSubmissionInput.parse(payload.submission)
    if (payload.kind !== 'benchmark-submission-v1' || payload.id !== run.id || payload.definition_hash !== run.definition_hash
      || digest(data) !== run.submission_hash) throw new Error('Binding')
    return data
  } catch { fail('BENCHMARK_MATERIAL_INTEGRITY', 422) }
}
async function liveGrant(run: Run, definition: Definition, source: Source) {
  if (!unfinished.includes(run.state as typeof unfinished[number]) || run.expires_at <= new Date()
    || definition.status !== 'active' || run.definition_hash !== definition.definition_hash
    || run.grader_agent_id !== definition.grader_agent_id || !await graderEligible(run.grader_agent_id, source)
    || !await peerBenchmarkParticipantsEligible(source, run.target_agent_id, run.grader_agent_id)
    || run.participants_hash !== await participantHash(run.target_agent_id, run.grader_agent_id, source)) fail('BENCHMARK_GRANT_INACTIVE')
}
async function linkedRun(id: string, source: Source) {
  const [row] = await source.select({ run: benchmark_runs, definition: benchmark_definitions }).from(benchmark_runs)
    .innerJoin(benchmark_definitions, eq(benchmark_runs.definition_id, benchmark_definitions.id)).where(eq(benchmark_runs.id, id)).limit(1)
  return row || fail('BENCHMARK_RUN_NOT_FOUND', 404)
}
export async function publishBenchmarkDefinition(actor: string, input: unknown) {
  const parsed = benchmarkDefinitionInput.safeParse(input)
  if (!parsed.success) fail('BENCHMARK_DEFINITION_INVALID', 400)
  const data = parsed.data, requestHash = digest(data)
  return durable(`definition:${data.suite_key}:${data.version}`, () => db.transaction(async (tx) => {
    const [prior] = await tx.select().from(benchmark_definitions).where(and(eq(benchmark_definitions.suite_key, data.suite_key), eq(benchmark_definitions.version, data.version))).limit(1)
    if (prior) {
      if (prior.request_hash !== requestHash) fail('BENCHMARK_VERSION_CONFLICT')
      return { definition: definitionMetadata(prior), reused: true }
    }
    if (!await graderEligible(data.grader_agent_id, tx)) fail('BENCHMARK_GRADER_UNAVAILABLE')
    const id = crypto.randomUUID(), payload = { kind: 'benchmark-definition-v1', id, salt: randomBytes(32).toString('hex'), definition: data }
    const encrypted = await encryptArtifact(JSON.stringify(payload))
    const [row] = await tx.insert(benchmark_definitions).values({ id, suite_key: data.suite_key, version: data.version, title: data.title,
      capability_id: data.capability_id, grader_agent_id: data.grader_agent_id, definition_hash: digest(payload), request_hash: requestHash,
      ...encrypted, case_count: data.cases.length, created_by: actor }).returning()
    return { definition: definitionMetadata(row), reused: false }
  }))
}
export async function retireBenchmarkDefinition(id: string, actor: string) {
  return durable(`retire:${id}`, () => db.transaction(async (tx) => {
    const [prior] = await tx.select().from(benchmark_definitions).where(eq(benchmark_definitions.id, id)).limit(1)
    if (!prior) fail('BENCHMARK_DEFINITION_NOT_FOUND', 404)
    if (prior.status === 'retired') return { definition: definitionMetadata(prior) }
    const [row] = await tx.update(benchmark_definitions).set({ status: 'retired', retired_by: actor, retired_at: new Date() }).where(eq(benchmark_definitions.id, id)).returning()
    if (!row) fail('BENCHMARK_DEFINITION_NOT_FOUND', 404)
    await tx.update(benchmark_runs).set({ state: 'cancelled', submission_ciphertext: null, submission_nonce: null, completed_at: new Date() })
      .where(and(eq(benchmark_runs.definition_id, id), inArray(benchmark_runs.state, [...unfinished])))
    return { definition: definitionMetadata(row) }
  }))
}
export async function listBenchmarkDefinitions(limit: number, offset: number, capability?: string) {
  const where = and(eq(benchmark_definitions.status, 'active'), capability ? eq(benchmark_definitions.capability_id, capability) : undefined)
  const [rows, [count]] = await Promise.all([db.select().from(benchmark_definitions).where(where).orderBy(desc(benchmark_definitions.created_at), desc(benchmark_definitions.id)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(benchmark_definitions).where(where)])
  return { definitions: await Promise.all(rows.map(async (row) => ({ ...definitionMetadata(row), grader_available: await graderEligible(row.grader_agent_id, db) }))), total: Number(count.total) }
}
export async function createBenchmarkRun(target: string, input: unknown) {
  const parsed = createInput.safeParse(input)
  if (!parsed.success) fail('BENCHMARK_RUN_INVALID', 400)
  const data = parsed.data, requestHash = digest(data)
  return durable(`target:${target}`, () => db.transaction(async (tx) => {
    const [prior] = await tx.select().from(benchmark_runs).where(and(eq(benchmark_runs.target_agent_id, target), eq(benchmark_runs.client_reference, data.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== requestHash) fail('BENCHMARK_REFERENCE_CONFLICT')
      const { definition } = await linkedRun(prior.id, tx)
      return { run: runMetadata(prior, definition), reused: true }
    }
    const [definition] = await tx.select().from(benchmark_definitions).where(eq(benchmark_definitions.id, data.definition_id)).limit(1)
    if (!definition) fail('BENCHMARK_DEFINITION_NOT_FOUND', 404)
    const ownersHash = await participantHash(target, definition.grader_agent_id, tx)
    const draft = { state: 'awaiting_submission', expires_at: new Date(Date.now() + 600_000), target_agent_id: target,
      grader_agent_id: definition.grader_agent_id, definition_hash: definition.definition_hash, participants_hash: ownersHash } as Run
    await liveGrant(draft, definition, tx)
    await privateDefinition(definition)
    const [{ count }] = await tx.select({ count: sql<number>`count(*)` }).from(benchmark_runs).where(and(eq(benchmark_runs.target_agent_id, target), eq(benchmark_runs.definition_id, definition.id)))
    const [{ pending }] = await tx.select({ pending: sql<number>`count(*)` }).from(benchmark_runs).where(and(eq(benchmark_runs.target_agent_id, target), inArray(benchmark_runs.state, [...unfinished]), gt(benchmark_runs.expires_at, new Date())))
    if (Number(count) >= 3 || Number(pending) >= 8) fail('BENCHMARK_RUN_LIMIT', 429)
    const [row] = await tx.insert(benchmark_runs).values({ id: crypto.randomUUID(), definition_id: definition.id,
      definition_hash: definition.definition_hash, target_agent_id: target, grader_agent_id: definition.grader_agent_id,
      participants_hash: ownersHash, client_reference: data.client_reference, request_hash: requestHash, expires_at: draft.expires_at }).returning()
    return { run: runMetadata(row, definition), reused: false }
  }))
}
export async function readBenchmarkRun(id: string, reader: BenchmarkReader) {
  return db.transaction(async (tx) => {
    const { run, definition } = await linkedRun(id, tx)
    const ownerIds = reader.ownerId ? (await tx.select({ agentId: agent_owners.agentId }).from(agent_owners)
      .where(and(eq(agent_owners.userId, reader.ownerId), inArray(agent_owners.agentId, [run.target_agent_id, run.grader_agent_id])))).map((row) => row.agentId) : []
    const target = reader.agentId === run.target_agent_id || ownerIds.includes(run.target_agent_id)
    const grader = reader.agentId === run.grader_agent_id
    if (!target && !grader && !ownerIds.includes(run.grader_agent_id)) fail('BENCHMARK_RUN_NOT_FOUND', 404)
    if (unfinished.includes(run.state as typeof unfinished[number]) && run.expires_at <= new Date()) {
      const completed = new Date()
      await tx.update(benchmark_runs).set({ state: 'expired', submission_ciphertext: null, submission_nonce: null, completed_at: completed }).where(eq(benchmark_runs.id, run.id))
      run.state = 'expired'
      run.completed_at = completed
    }
    const response = { run: runMetadata(run, definition) }
    if (!unfinished.includes(run.state as typeof unfinished[number])) return response
    await liveGrant(run, definition, tx)
    const suite = await privateDefinition(definition)
    if (grader && run.state === 'awaiting_grading') return { ...response, grading_material: { adapter: suite.adapter, cases: suite.cases, submission: await privateSubmission(run) } }
    if (target) return { ...response, test_cases: suite.cases.map(({ id, input }) => ({ id, input })) }
    return response
  })
}
export async function submitBenchmarkOutputs(id: string, actor: string, input: unknown) {
  const parsed = benchmarkSubmissionInput.safeParse(input)
  if (!parsed.success) fail('BENCHMARK_SUBMISSION_INVALID', 400)
  const data = { outputs: [...parsed.data.outputs].sort((a, b) => compare(a.id, b.id)) }, submissionHash = digest(data)
  return durable(`run:${id}`, () => db.transaction(async (tx) => {
    const { run, definition } = await linkedRun(id, tx)
    if (actor !== run.target_agent_id) fail('BENCHMARK_RUN_NOT_FOUND', 404)
    if (run.submission_hash) {
      if (run.submission_hash !== submissionHash) fail('BENCHMARK_SUBMISSION_CONFLICT')
      return { run: runMetadata(run, definition), reused: true }
    }
    await liveGrant(run, definition, tx)
    const suite = await privateDefinition(definition)
    if (canonicalContract(data.outputs.map(({ id }) => id)) !== canonicalContract(suite.cases.map(({ id }) => id).sort())) fail('BENCHMARK_CASE_MISMATCH', 422)
    const encrypted = await encryptArtifact(JSON.stringify({ kind: 'benchmark-submission-v1', id, definition_hash: run.definition_hash, submission: data }))
    const [row] = await tx.update(benchmark_runs).set({ state: 'awaiting_grading', submission_hash: submissionHash,
      submission_ciphertext: encrypted.ciphertext, submission_nonce: encrypted.nonce })
      .where(and(eq(benchmark_runs.id, id), eq(benchmark_runs.state, 'awaiting_submission'), gt(benchmark_runs.expires_at, new Date()))).returning()
    if (!row) fail('BENCHMARK_GRANT_INACTIVE')
    return { run: runMetadata(row, definition), reused: false }
  }))
}
export async function submitBenchmarkReport(id: string, actor: string, input: unknown) {
  const parsed = benchmarkReportInput.safeParse(input)
  if (!parsed.success) fail('BENCHMARK_REPORT_INVALID', 400)
  const report = { ...parsed.data, cases: [...parsed.data.cases].sort((a, b) => compare(a.id, b.id)) }, reportHash = digest(report)
  return durable(`run:${id}`, () => db.transaction(async (tx) => {
    const { run, definition } = await linkedRun(id, tx)
    if (actor !== run.grader_agent_id) fail('BENCHMARK_RUN_NOT_FOUND', 404)
    if (run.report_hash) {
      if (run.report_hash !== reportHash) fail('BENCHMARK_REPORT_CONFLICT')
      return { run: runMetadata(run, definition), reused: true }
    }
    await liveGrant(run, definition, tx)
    if (run.state !== 'awaiting_grading' || report.definition_hash !== run.definition_hash || report.submission_hash !== run.submission_hash) fail('BENCHMARK_REPORT_BINDING', 422)
    const suite = await privateDefinition(definition), submission = await privateSubmission(run)
    const actual = submission.outputs.map(({ id, output }) => ({ id, passed: canonicalContract(output) === canonicalContract(suite.cases.find((item) => item.id === id)?.expected) }))
    if (canonicalContract(actual) !== canonicalContract(report.cases)) fail('BENCHMARK_REPORT_RESULT_MISMATCH', 422)
    const [row] = await tx.update(benchmark_runs).set({ state: 'graded', passed_count: actual.filter(({ passed }) => passed).length,
      report_json: canonicalContract(report), report_hash: reportHash, submission_ciphertext: null, submission_nonce: null, completed_at: new Date() })
      .where(and(eq(benchmark_runs.id, id), eq(benchmark_runs.state, 'awaiting_grading'), gt(benchmark_runs.expires_at, new Date()))).returning()
    if (!row) fail('BENCHMARK_GRANT_INACTIVE')
    return { run: runMetadata(row, definition), reused: false }
  }))
}
export async function cancelBenchmarkRun(id: string, actor: string) {
  return durable(`run:${id}`, () => db.transaction(async (tx) => {
    const { run, definition } = await linkedRun(id, tx)
    if (actor !== run.target_agent_id) fail('BENCHMARK_RUN_NOT_FOUND', 404)
    if (run.state === 'cancelled') return { run: runMetadata(run, definition), reused: true }
    if (!unfinished.includes(run.state as typeof unfinished[number])) fail('BENCHMARK_RUN_TERMINAL')
    const [row] = await tx.update(benchmark_runs).set({ state: 'cancelled', submission_ciphertext: null, submission_nonce: null, completed_at: new Date() }).where(eq(benchmark_runs.id, id)).returning()
    return { run: runMetadata(row, definition), reused: false }
  }))
}
export async function expireBenchmarkRuns() {
  return durable('expiry', () => db.transaction(async (tx) => {
    const rows = await tx.select({ id: benchmark_runs.id }).from(benchmark_runs).where(and(inArray(benchmark_runs.state, [...unfinished]), lte(benchmark_runs.expires_at, new Date()))).limit(100)
    if (!rows.length) return 0
    return (await tx.update(benchmark_runs).set({ state: 'expired', submission_ciphertext: null, submission_nonce: null, completed_at: new Date() })
      .where(and(inArray(benchmark_runs.id, rows.map(({ id }) => id)), inArray(benchmark_runs.state, [...unfinished]))).returning()).length
  }))
}
