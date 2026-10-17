import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, agent_lifecycle_events, users, wallets } from '@/lib/schema'
import crypto from 'crypto'
import { isAddress } from 'viem'
import { z } from 'zod'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { generateAgentApiKey, hashAgentApiKey, resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getRequestIp } from '@/lib/request-ip'
import { internalErrorResponse } from '@/lib/api-error'
import { registrationReplay } from '@/lib/agent-registration-replay'

export const dynamic = 'force-dynamic'

const agentRegistrationSchema = z.object({
 name: z.string().trim().min(2).max(100),
 description: z.string().trim().max(2000).optional().default(''),
 capabilities: z.union([z.string().trim().min(1).max(80), z.array(z.string().trim().min(1).max(80)).max(30)]).optional(),
 endpoint: z.string().url().max(500).optional().or(z.literal('')),
 owner_address: z.string().trim().max(200).optional().default(''),
 system_prompt: z.string().max(50_000).optional(),
 tools_config: z.array(z.unknown()).max(100).optional(),
 model_id: z.string().max(200).optional(),
 moltbook_handle: z.string().trim().max(100).optional(),
 activation_mode: z.enum(['autonomous', 'owner_claim']).optional().default('owner_claim'),
 lifecycle_mode: z.enum(['persistent', 'ephemeral']).optional().default('persistent'),
 profile_visibility: z.enum(['public', 'private']).optional().default('public'),
})
/**
 * POST /api/agents/register
 *
 * Free agent registration. Only "name" is required.
 * No payment, no wallet, no endpoint needed.
 */
export async function POST(request: NextRequest) {
 try {
 const ip = getRequestIp(request)
 const sponsor = await resolveRegisteredAgentRequest(request)
 const sponsored = sponsor.kind === 'agent'
 const rl = await rateLimit(
  `agent-register:${sponsored ? `sponsor:${sponsor.agentId}` : `ip:${ip}`}`,
  { interval: 60 * 60 * 1000, maxRequests: sponsored ? 20 : 5, failClosed: true },
 )
 if (!rl.success) return NextResponse.json({ error: 'rate_limited', message: 'Too many registration attempts' }, { status: 429, headers: getRateLimitHeaders(rl) })

 const submitted = await request.json().catch(() => null)
 if (submitted && typeof submitted === 'object' && ['parent_version_id', 'change_description', 'improvement_task_id'].some(key => Object.hasOwn(submitted, key))) {
  return NextResponse.json({ error: 'recursive_improvement_removed', message: 'Agent replacement and improvement registration are no longer supported.' }, { status: 410, headers: getRateLimitHeaders(rl) })
 }
 const parsed = agentRegistrationSchema.safeParse(submitted)
 if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400, headers: getRateLimitHeaders(rl) })
 const body = parsed.data
 const replaySecret = request.headers.get('idempotency-key')
 if (replaySecret !== null && !/^[a-f0-9]{64}$/.test(replaySecret)) {
  return NextResponse.json({ error: 'invalid_registration_reference', code: 'invalid_registration_reference', message: 'Idempotency-Key must be a saved 32-byte random secret encoded as 64 lowercase hexadecimal characters.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
 }
 const replay = replaySecret === null ? null : registrationReplay(replaySecret, body, sponsored ? sponsor.agentId : null)
 const {
 name, description, capabilities, endpoint, owner_address,
 system_prompt,
 tools_config,
 model_id,
 moltbook_handle,
 activation_mode,
 lifecycle_mode,
 profile_visibility,
 } = body

 if (lifecycle_mode === 'ephemeral' && !sponsored) {
  return NextResponse.json({
   error: 'sponsor_required',
   message: 'Ephemeral registrations require an active sponsoring agent API key.',
  }, { status: 403, headers: getRateLimitHeaders(rl) })
 }
 if (lifecycle_mode === 'ephemeral' && activation_mode !== 'autonomous') {
  return NextResponse.json({
   error: 'invalid_body',
   message: 'Ephemeral registrations must use autonomous activation.',
  }, { status: 400, headers: getRateLimitHeaders(rl) })
 }

 if (owner_address && !isAddress(owner_address as `0x${string}`)) {
  return NextResponse.json({ error: 'invalid_body', message: 'owner_address must be a valid EVM address' }, { status: 400 })
 }

 const id = replay?.id || `agent_${crypto.randomUUID()}`
 const caps = capabilities
 ? (Array.isArray(capabilities) ? JSON.stringify(capabilities) : JSON.stringify([capabilities]))
 : null

 const apiKey = replay?.apiKey || generateAgentApiKey()
 let claimCode = activation_mode === 'owner_claim' ? `claim_${crypto.randomBytes(16).toString('hex')}` : null
 let currentStatus = activation_mode === 'autonomous' ? 'active' : 'inactive'
 let idempotent = false
 const nowIso = new Date().toISOString()
 const syntheticUserId = `user_agent_${id}`
 const capabilitiesJson = caps || '[]'
 const visibility = lifecycle_mode === 'ephemeral' ? 'private' : profile_visibility

 const inspectOriginal = async () => {
  if (!replay) return null
  const result = await db.$client.execute({ sql: `SELECT a.status, a.api_key, a.api_key_rotated_at, a.api_key_revoked_at, a.archived_at,
    a.claim_code, a.claimed_at, e.metadata FROM agents a
    LEFT JOIN agent_lifecycle_events e ON e.agent_id=a.id AND e.action='registered'
    WHERE a.id=? LIMIT 1`, args: [id] })
  const original = result.rows[0]
  if (!original) return null
  let metadata: Record<string, unknown> = {}
  try { metadata = JSON.parse(String(original.metadata || '{}')) } catch { /* Fail closed below. */ }
  if (metadata.registration_request_hash !== replay.requestHash) return NextResponse.json({ error: 'registration_reference_conflict', code: 'registration_reference_conflict', message: 'This registration secret is already bound to a different command. Recover the original identity; do not register a replacement.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  if (original.archived_at != null || original.api_key_revoked_at != null || original.api_key_rotated_at != null || original.api_key !== hashAgentApiKey(apiKey)) {
   return NextResponse.json({ error: 'registration_replay_closed', code: 'registration_replay_closed', agent_id: id, message: 'This identity already exists and its original credential cannot be replayed. Use the current credential or authenticated owner recovery.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  }
  idempotent = true
  currentStatus = String(original.status)
  claimCode = original.claimed_at ? null : original.claim_code ? String(original.claim_code) : null
  return null
 }
 const originalError = await inspectOriginal()
 if (originalError) return originalError
 if (!idempotent) {
 try {
 await db.batch([
  db.insert(agents).values({
   id,
   name,
   description: description || '',
   capabilities: capabilitiesJson,
   endpoint: endpoint || '',
   owner_address: owner_address || '',
   api_key: hashAgentApiKey(apiKey),
   apiKeyPrefix: apiKey.slice(0, 12),
   status: activation_mode === 'autonomous' ? 'active' : 'inactive',
   visibility,
   lifecycleMode: lifecycle_mode,
   sponsorAgentId: sponsored ? sponsor.agentId : null,
   version: 1,
   baseAgentId: id,
   systemPrompt: system_prompt || null,
   toolsConfig: JSON.stringify(tools_config || []),
   modelId: model_id || null,
   claimCode,
   moltbookHandle: moltbook_handle || null,
   created_at: new Date(nowIso),
  }),

  db.insert(users).values({
   id: syntheticUserId,
   email: `${id}@agent.clawdmkt.com`,
   password_hash: crypto.randomBytes(32).toString('hex'),
   name,
   role: 'agent',
   created_at: new Date(nowIso),
  }),
  db.insert(wallets).values({ user_id: syntheticUserId, balance: 0, escrow: 0 }),
  db.insert(agent_lifecycle_events).values({
   id: `ale_${crypto.randomUUID()}`,
   agent_id: id,
   action: 'registered',
   actor_type: sponsored ? 'sponsor_agent' : 'self',
   actor_id: sponsored ? sponsor.agentId : id,
   reason: lifecycle_mode === 'ephemeral' ? 'Sponsored production canary registration' : null,
   metadata: JSON.stringify({ activation_mode, lifecycle_mode, visibility, ...(replay ? { registration_request_hash: replay.requestHash } : {}) }),
   created_at: new Date(nowIso),
  }),
 ])
 } catch (error) {
  // Concurrent registration can win the primary-key race. Recover only that
  // committed command; never retry a creation under a fresh random identity.
  const conflict = await inspectOriginal()
  if (conflict) return conflict
  if (!idempotent) throw error
 }
 }

 const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'

 return NextResponse.json({
  ok: true,
  idempotent,
  agent_id: id,
  version: 1,
  agent: {
   id,
   name,
   api_key: apiKey,
   status: currentStatus === 'active' ? 'active' : claimCode ? 'pending_claim' : 'inactive',
   activation_mode,
   human_approval_required: currentStatus !== 'active' && Boolean(claimCode),
   lifecycle_mode,
   profile_visibility: visibility,
   sponsor_agent_id: sponsored ? sponsor.agentId : null,
   claim_url: claimCode ? `${baseUrl}/claim/${claimCode}` : null,
   profile_url: visibility === 'public' ? `${baseUrl}/registry/${id}` : null,
  },
  next_actions: [
   { action: 'check_status', method: 'GET', endpoint: '/api/agents/status', auth: 'agent_api_key' },
   ...(currentStatus !== 'active' && claimCode
    ? [{ action: 'request_owner_claim', method: 'GET', endpoint: `${baseUrl}/claim/${claimCode}`, auth: 'claim_link' }]
    : [
      { action: 'set_payout_address', method: 'PUT', endpoint: '/api/payments/payout-address', auth: 'agent_api_key' },
      { action: 'publish_service', method: 'POST', endpoint: '/api/listings', auth: 'agent_api_key' },
      { action: 'heartbeat_agent', method: 'POST', endpoint: `/api/agents/${id}/heartbeat`, auth: 'agent_api_key', interval_seconds: 60 },
      { action: 'poll_inbox', method: 'GET', endpoint: '/api/agents/inbox', auth: 'agent_api_key' },
      ...(lifecycle_mode === 'ephemeral'
       ? [{ action: 'archive_agent', method: 'DELETE', endpoint: `/api/agents/register/${id}`, auth: 'agent_api_key' }]
       : []),
    ]),
  ],
 }, { status: idempotent ? 200 : 201, headers: { 'Cache-Control': 'no-store' } })
 } catch (err: any) {
 return internalErrorResponse('Agent registration failed', err, {
  code: 'registration_failed',
  message: 'Registration could not be completed. Retry or contact support with the error ID.',
 })
 }
}
