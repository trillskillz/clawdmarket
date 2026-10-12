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

 const id = `agent_${crypto.randomUUID()}`
 const caps = capabilities
 ? (Array.isArray(capabilities) ? JSON.stringify(capabilities) : JSON.stringify([capabilities]))
 : null

 const apiKey = generateAgentApiKey()
 const claimCode = activation_mode === 'owner_claim' ? `claim_${crypto.randomBytes(16).toString('hex')}` : null
 const nowIso = new Date().toISOString()
 const syntheticUserId = `user_agent_${id}`
 const capabilitiesJson = caps || '[]'
 const visibility = lifecycle_mode === 'ephemeral' ? 'private' : profile_visibility

 await db.transaction(async (tx) => {
  await tx.insert(agents).values({
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
  })

  await tx.insert(users).values({
   id: syntheticUserId,
   email: `${id}@agent.clawdmkt.com`,
   password_hash: crypto.randomBytes(32).toString('hex'),
   name,
   role: 'agent',
   created_at: new Date(nowIso),
  })
  await tx.insert(wallets).values({ user_id: syntheticUserId, balance: 0, escrow: 0 })
  await tx.insert(agent_lifecycle_events).values({
   id: `ale_${crypto.randomUUID()}`,
   agent_id: id,
   action: 'registered',
   actor_type: sponsored ? 'sponsor_agent' : 'self',
   actor_id: sponsored ? sponsor.agentId : id,
   reason: lifecycle_mode === 'ephemeral' ? 'Sponsored production canary registration' : null,
   metadata: JSON.stringify({ activation_mode, lifecycle_mode, visibility }),
   created_at: new Date(nowIso),
  })
 })

 const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'

 return NextResponse.json({
  ok: true,
  agent_id: id,
  version: 1,
  agent: {
   id,
   name,
   api_key: apiKey,
   status: activation_mode === 'autonomous' ? 'active' : 'pending_claim',
   activation_mode,
   human_approval_required: activation_mode === 'owner_claim',
   lifecycle_mode,
   profile_visibility: visibility,
   sponsor_agent_id: sponsored ? sponsor.agentId : null,
   claim_url: claimCode ? `${baseUrl}/claim/${claimCode}` : null,
   profile_url: visibility === 'public' ? `${baseUrl}/registry/${id}` : null,
  },
  next_actions: [
   { action: 'check_status', method: 'GET', endpoint: '/api/agents/status', auth: 'agent_api_key' },
   ...(activation_mode === 'owner_claim'
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
 }, { status: 201 })
 } catch (err: any) {
 return internalErrorResponse('Agent registration failed', err, {
  code: 'registration_failed',
  message: 'Registration could not be completed. Retry or contact support with the error ID.',
 })
 }
}
