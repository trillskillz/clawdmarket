import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { private_artifacts, private_artifact_payloads, route_plans, service_orders, service_definitions, service_execution_attempts, trades } from './schema'
import { decryptArtifact, encryptArtifact } from './artifact-crypto'
import { withKeyedWriteLock } from './service-reservation-lock'
import { serviceExecutionContract } from './service-execution-contract'

export const ARTIFACT_LIMITS = { max_bytes: 65_536, max_trade_bytes: 262_144, max_trade_artifacts: 8, retention_days: 90, request_bytes: 96_000 } as const
export const ARTIFACT_MEDIA_TYPES = ['application/json', 'text/plain', 'text/markdown', 'application/pdf', 'application/octet-stream'] as const
export const artifactUploadSchema = z.object({
  client_reference: z.string().min(8).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  name: z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/),
  media_type: z.enum(ARTIFACT_MEDIA_TYPES),
  content_base64: z.string().min(4).max(87_384),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.object({ description: z.string().trim().min(1).max(2000).optional(),
    source_uri: z.string().url().max(2000).refine((value) => /^https?:\/\//i.test(value)).optional() }).strict().default({}),
  execution_attempt_id: z.uuid().optional(),
}).strict()

export class ArtifactError extends Error {
  constructor(public code: string, public status: number) { super(code) }
}
export const privateArtifactHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff' }
type Source = Pick<typeof db, 'select'>
type Metadata = typeof private_artifacts.$inferSelect
const terminalStates = ['completed', 'cancelled', 'resolved']
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function decode(value: string) {
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > ARTIFACT_LIMITS.max_bytes || bytes.toString('base64') !== value) throw new ArtifactError('ARTIFACT_CONTENT_INVALID', 400)
  return bytes
}
function validateMedia(bytes: Buffer, media: string) {
  if (media === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new ArtifactError('ARTIFACT_MEDIA_INVALID', 400)
  if (media === 'application/json' || media.startsWith('text/')) {
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ArtifactError('ARTIFACT_MEDIA_INVALID', 400) }
    if (media === 'application/json') {
      try { JSON.parse(text) } catch { throw new ArtifactError('ARTIFACT_MEDIA_INVALID', 400) }
    }
  }
}
export function artifactMetadata(row: Metadata, tradeStatus: string) {
  return { id: row.id, trade_id: row.trade_id, order_id: row.order_id, route_id: row.route_id, delivery_id: row.delivery_id,
    uploader_id: row.uploader_id, name: row.name, media_type: row.media_type, size_bytes: row.size_bytes, sha256: row.sha256,
    provenance: { kind: 'provider_declared', recorded_by: row.uploader_id, verified: false, ...JSON.parse(row.provenance_json) },
    created_at: row.created_at, retention_expires_at: row.retention_expires_at,
    retention_hold: !terminalStates.includes(tradeStatus), purged_at: row.purged_at,
    download_path: `/api/trades/${row.trade_id}/artifacts/${row.id}` }
}
export async function authorizeArtifactTrade(tradeId: string, userId: string, source: Source = db) {
  const [trade] = await source.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  if (!trade || ![trade.buyer_id, trade.seller_id].includes(userId)) throw new ArtifactError('TRADE_NOT_FOUND', 404)
  return trade
}
export async function listPrivateArtifacts(tradeId: string, userId: string) {
  const trade = await authorizeArtifactTrade(tradeId, userId)
  const rows = await db.select().from(private_artifacts).where(eq(private_artifacts.trade_id, tradeId)).orderBy(private_artifacts.created_at)
  return rows.map((row) => artifactMetadata(row, trade.status))
}

async function verifyPayload(row: Metadata, source: Source, tradeStatus: string) {
  if (row.purged_at || terminalStates.includes(tradeStatus) && row.retention_expires_at <= new Date()) throw new ArtifactError('ARTIFACT_EXPIRED', 410)
  const [payload] = await source.select().from(private_artifact_payloads).where(eq(private_artifact_payloads.artifact_id, row.id)).limit(1)
  if (!payload) throw new ArtifactError('ARTIFACT_INTEGRITY_FAILED', 422)
  try {
    const binding = JSON.parse(await decryptArtifact(payload.ciphertext, payload.nonce))
    const bytes = decode(binding.content_base64)
    const identity = { id: row.id, trade_id: row.trade_id, name: row.name, media_type: row.media_type,
      size_bytes: row.size_bytes, sha256: row.sha256, provenance_json: row.provenance_json, uploader_id: row.uploader_id }
    if (JSON.stringify(binding.identity) !== JSON.stringify(identity) || bytes.length !== row.size_bytes || hash(bytes) !== row.sha256) throw new Error('Invalid binding')
    validateMedia(bytes, row.media_type)
    return bytes
  } catch { throw new ArtifactError('ARTIFACT_INTEGRITY_FAILED', 422) }
}
export async function downloadPrivateArtifact(tradeId: string, artifactId: string, userId: string) {
  const trade = await authorizeArtifactTrade(tradeId, userId)
  const [row] = await db.select().from(private_artifacts).where(and(eq(private_artifacts.id, artifactId), eq(private_artifacts.trade_id, tradeId))).limit(1)
  if (!row) throw new ArtifactError('ARTIFACT_NOT_FOUND', 404)
  return { metadata: artifactMetadata(row, trade.status), bytes: await verifyPayload(row, db, trade.status) }
}

/** Used in the delivery transaction: immutable references, content integrity, no URL fetching or code execution. */
export async function loadDeliveryArtifacts(tradeId: string, ids: string[], tradeStatus: string, source: Source = db) {
  const result = []
  for (const id of ids) {
    const [row] = await source.select().from(private_artifacts).where(and(eq(private_artifacts.id, id), eq(private_artifacts.trade_id, tradeId))).limit(1)
    if (!row || row.delivery_id) throw new ArtifactError('ARTIFACT_NOT_AVAILABLE', 409)
    result.push({ row, bytes: await verifyPayload(row, source, tradeStatus) })
  }
  return result
}

async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run() } catch (error) {
      let cause: unknown = error
      let busy = false
      for (let depth = 0; cause && depth < 6; depth++) {
        if (typeof cause === 'object') {
          if ('code' in cause && String(cause.code).startsWith('SQLITE_BUSY')) busy = true
          if ('message' in cause && /SQLITE_BUSY|database is locked/i.test(String(cause.message))) busy = true
          cause = 'cause' in cause ? cause.cause : null
        } else break
      }
      if (!busy) throw error
      if (attempt >= 7) throw new ArtifactError('ARTIFACT_STORAGE_BUSY', 503)
      await new Promise((resolve) => setTimeout(resolve, Math.min(400, 20 * 2 ** attempt) + Math.floor(Math.random() * 20)))
    }
  }
}
export async function uploadPrivateArtifact(tradeId: string, sellerId: string, input: unknown) {
  const parsed = artifactUploadSchema.safeParse(input)
  if (!parsed.success) throw new ArtifactError('ARTIFACT_UPLOAD_INVALID', 400)
  const data = parsed.data
  const bytes = decode(data.content_base64)
  if (hash(bytes) !== data.sha256) throw new ArtifactError('ARTIFACT_HASH_MISMATCH', 422)
  validateMedia(bytes, data.media_type)
  const requestHash = hash(JSON.stringify(data))
  const id = crypto.randomUUID()
  const identity = { id, trade_id: tradeId, name: data.name, media_type: data.media_type,
    size_bytes: bytes.length, sha256: data.sha256, provenance_json: JSON.stringify(data.provenance), uploader_id: sellerId }
  const encrypted = await encryptArtifact(JSON.stringify({ identity, content_base64: data.content_base64 }))
  return withKeyedWriteLock(`delivery:${tradeId}`, () => retry(() => db.transaction(async (tx) => {
    const trade = await authorizeArtifactTrade(tradeId, sellerId, tx)
    if (trade.seller_id !== sellerId) throw new ArtifactError('ARTIFACT_SELLER_REQUIRED', 403)
    const [existing] = await tx.select().from(private_artifacts).where(and(eq(private_artifacts.trade_id, tradeId), eq(private_artifacts.client_reference, data.client_reference))).limit(1)
    if (existing) {
      if (existing.request_hash !== requestHash || existing.uploader_id !== sellerId) throw new ArtifactError('ARTIFACT_REFERENCE_CONFLICT', 409)
      return { artifact: artifactMetadata(existing, trade.status), idempotent: true }
    }
    if (trade.status !== 'escrow_held') throw new ArtifactError('ARTIFACT_TRADE_NOT_FUNDED', 409)
    const [linked] = await tx.select({ order_id: service_orders.id, state: service_orders.state, execution_contract_json: service_orders.execution_contract_json,
      provider_protocol: service_definitions.provider_protocol }).from(service_orders)
      .innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id)).where(eq(service_orders.trade_id, tradeId)).limit(1)
    if (linked) {
      if (!['funded', 'executing'].includes(linked.state)) throw new ArtifactError('ARTIFACT_ORDER_NOT_ACTIVE', 409)
      if (serviceExecutionContract(linked, linked).provider_protocol === 'leased_v1') {
        const [attempt] = await tx.select().from(service_execution_attempts).where(eq(service_execution_attempts.order_id, linked.order_id)).limit(1)
        if (!attempt || data.execution_attempt_id !== attempt.id || attempt.state !== 'accepted' || !attempt.lease_expires_at || attempt.lease_expires_at <= new Date()) throw new ArtifactError('ARTIFACT_ACTIVE_ATTEMPT_REQUIRED', 409)
      }
    }
    const existingRows = await tx.select({ size: private_artifacts.size_bytes }).from(private_artifacts).where(eq(private_artifacts.trade_id, tradeId))
    if (existingRows.length >= ARTIFACT_LIMITS.max_trade_artifacts || existingRows.reduce((sum, row) => sum + row.size, bytes.length) > ARTIFACT_LIMITS.max_trade_bytes) throw new ArtifactError('ARTIFACT_TRADE_LIMIT', 413)
    const [route] = linked ? await tx.select({ id: route_plans.id }).from(route_plans).where(eq(route_plans.service_order_id, linked.order_id)).limit(1) : []
    const now = new Date()
    const [row] = await tx.insert(private_artifacts).values({ ...identity, order_id: linked?.order_id ?? null, route_id: route?.id ?? null,
      client_reference: data.client_reference, request_hash: requestHash, created_at: now,
      retention_expires_at: new Date(now.getTime() + ARTIFACT_LIMITS.retention_days * 86_400_000) }).returning()
    await tx.insert(private_artifact_payloads).values({ artifact_id: id, ...encrypted })
    return { artifact: artifactMetadata(row, trade.status), idempotent: false }
  })))
}

/** Bounded cron sweep. Keep immutable metadata/evidence; hold bytes for unfinished/disputed trades. */
export async function purgeExpiredArtifacts(limit = 100) {
  return retry(() => db.transaction(async (tx) => {
    const now = new Date()
    const rows = await tx.select({ id: private_artifacts.id }).from(private_artifacts).innerJoin(trades, eq(trades.id, private_artifacts.trade_id))
      .where(and(lte(private_artifacts.retention_expires_at, now), isNull(private_artifacts.purged_at), inArray(trades.status, terminalStates as ('completed' | 'cancelled' | 'resolved')[]))).limit(Math.min(100, Math.max(1, limit)))
    for (const row of rows) {
      await tx.delete(private_artifact_payloads).where(eq(private_artifact_payloads.artifact_id, row.id))
      await tx.update(private_artifacts).set({ purged_at: now }).where(eq(private_artifacts.id, row.id))
    }
    return rows.length
  }))
}

/** Stop reading before parsing JSON, including streamed requests with no Content-Length. */
export async function readBoundedJson(request: Request, maxBytes: number, timeoutMs = 10_000, allowEmpty = false) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new ArtifactError('REQUEST_TOO_LARGE', 413)
  if (!request.body) { if (allowEmpty) return {}; throw new ArtifactError('REQUEST_INVALID', 400) }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ArtifactError('REQUEST_TIMEOUT', 408)), timeoutMs) })
  try {
    while (true) {
      const part = await Promise.race([reader.read(), timeout])
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) throw new ArtifactError('REQUEST_TOO_LARGE', 413)
      chunks.push(part.value)
    }
    if (size === 0 && allowEmpty) return {}
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ArtifactError('REQUEST_INVALID', 400) }
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
}
