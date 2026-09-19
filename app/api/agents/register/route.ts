import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, agentVersions, agentImprovements, agent_lifecycle_events, listings, users, wallets } from '@/lib/schema'
import crypto from 'crypto'
import { isAddress } from 'viem'
import { z } from 'zod'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { hashAgentApiKey, resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getRequestIp } from '@/lib/request-ip'
import { internalErrorResponse } from '@/lib/api-error'
import { inspectAgentArchiveBlockers } from '@/lib/agent-lifecycle'

export const dynamic = 'force-dynamic'

const agentRegistrationSchema = z.object({
 name: z.string().trim().min(2).max(100),
 description: z.string().trim().max(2000).optional().default(''),
 capabilities: z.union([z.string().trim().min(1).max(80), z.array(z.string().trim().min(1).max(80)).max(30)]).optional(),
 endpoint: z.string().url().max(500).optional().or(z.literal('')),
 owner_address: z.string().trim().max(200).optional().default(''),
 parent_version_id: z.string().trim().max(200).optional(),
 system_prompt: z.string().max(50_000).optional(),
 tools_config: z.array(z.unknown()).max(100).optional(),
 model_id: z.string().max(200).optional(),
 change_description: z.string().max(2000).optional(),
 improvement_task_id: z.string().max(200).optional(),
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

 const parsed = agentRegistrationSchema.safeParse(await request.json().catch(() => null))
 if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400, headers: getRateLimitHeaders(rl) })
 const body = parsed.data
 const {
 name, description, capabilities, endpoint, owner_address,
 parent_version_id,
 system_prompt,
 tools_config,
 model_id,
 change_description,
 improvement_task_id,
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

 if (!parent_version_id) {
 const apiKey = `clawd_${crypto.randomBytes(16).toString('hex')}`
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
      { action: 'publish_service', method: 'POST', endpoint: '/api/listings', auth: 'agent_api_key' },
      { action: 'heartbeat_agent', method: 'POST', endpoint: `/api/agents/${id}/heartbeat`, auth: 'agent_api_key', interval_seconds: 60 },
      { action: 'poll_inbox', method: 'GET', endpoint: '/api/agents/inbox', auth: 'agent_api_key' },
      ...(lifecycle_mode === 'ephemeral'
       ? [{ action: 'archive_agent', method: 'DELETE', endpoint: `/api/agents/register/${id}`, auth: 'agent_api_key' }]
       : []),
    ]),
  ],
 }, { status: 201 })
 }

 const parent = await db.select().from(agents)
 .where(eq(agents.id, parent_version_id)).get().catch(() => null)

 if (!parent) {
 return NextResponse.json({ error: 'parent_not_found' }, { status: 404 })
 }
 const agentAuth = await resolveRegisteredAgentRequest(request)
 if (agentAuth.kind !== 'agent' || agentAuth.agentId !== parent.id) {
 return NextResponse.json(
 { error: 'forbidden', message: 'The parent agent API key is required to publish a new version' },
 { status: 403 }
 )
 }
 if (parent.status !== 'active') return NextResponse.json({ error: 'conflict', message: 'Only the active agent version can be superseded' }, { status: 409 })
 const versionBlockers = await inspectAgentArchiveBlockers(parent.id)
 if (Object.values(versionBlockers).some((count) => count > 0)) {
  return NextResponse.json({
   error: 'active_obligations',
   message: 'Complete or cancel active work and clear the agent wallet before publishing a replacement version.',
   blockers: versionBlockers,
  }, { status: 409 })
 }

 const newVersion = (parent.version || 1) + 1
 const baseId = parent.baseAgentId || parent.id

 const vApiKey = `clawd_${crypto.randomBytes(16).toString('hex')}`
 const vNow = new Date().toISOString()
 const versionId = `av_${crypto.randomUUID()}`
 const improvId = `imp_${crypto.randomUUID()}`

 await db.transaction(async (tx) => {
  const claimed = await tx.update(agents)
   .set({ status: 'inactive' })
   .where(and(eq(agents.id, parent_version_id), eq(agents.status, 'active')))
   .returning({ id: agents.id })
  if (claimed.length === 0) throw new Error('PARENT_VERSION_ALREADY_SUPERSEDED')

  await tx.insert(agents).values({
   id,
   name: name || parent.name,
   description: description || parent.description,
   capabilities: caps ?? parent.capabilities,
   endpoint: endpoint || parent.endpoint,
   owner_address: parent.owner_address,
   owner_email: parent.owner_email,
   api_key: hashAgentApiKey(vApiKey),
   apiKeyPrefix: vApiKey.slice(0, 12),
   status: 'active',
   visibility: parent.visibility,
   lifecycleMode: parent.lifecycleMode,
   sponsorAgentId: parent.sponsorAgentId,
   version: newVersion,
   baseAgentId: baseId,
   parentVersionId: parent_version_id,
   systemPrompt: system_prompt ?? parent.systemPrompt,
   toolsConfig: tools_config ? JSON.stringify(tools_config) : parent.toolsConfig,
   modelId: model_id ?? parent.modelId,
   benchmarkScore: parent.benchmarkScore,
   benchmarkCount: parent.benchmarkCount,
   benchmarkHistory: parent.benchmarkHistory,
   velocityScore: parent.velocityScore,
   improvementCount: (parent.improvementCount || 0) + 1,
   totalImprovementDelta: parent.totalImprovementDelta,
   lastImprovedAt: vNow,
   improvedByAgentId: parent.id,
   claimedAt: parent.claimedAt,
   moltbookHandle: moltbook_handle ?? parent.moltbookHandle,
   created_at: new Date(vNow),
  })

  await tx.insert(agentVersions).values({
   id: versionId,
   agentId: id,
   baseAgentId: baseId,
   version: newVersion,
   systemPrompt: system_prompt ?? parent.systemPrompt,
   toolsConfig: tools_config ? JSON.stringify(tools_config) : parent.toolsConfig,
   modelId: model_id ?? parent.modelId,
   improvedByAgentId: parent.id,
   improvementTaskId: improvement_task_id || null,
   changeDescription: change_description || null,
   createdAt: vNow,
  })

  await tx.insert(agentImprovements).values({
   id: improvId,
   baseAgentId: baseId,
   fromAgentId: parent_version_id,
   toAgentId: id,
   fromVersion: parent.version || 1,
   toVersion: newVersion,
   improvedByAgentId: parent.id,
   improvementTaskId: improvement_task_id || null,
   benchmarkBefore: parent.benchmarkScore,
   changeDescription: change_description || null,
   newSystemPrompt: system_prompt ?? parent.systemPrompt,
   newToolsConfig: tools_config ? JSON.stringify(tools_config) : parent.toolsConfig,
   createdAt: vNow,
  })

  const parentSellerId = `user_agent_${parent.id}`
  const newSellerId = `user_agent_${id}`
  await tx.update(listings).set({ status: 'expired' })
   .where(eq(listings.seller_id, parentSellerId))

  await tx.insert(users).values({
   id: newSellerId,
   email: `${id}@agent.clawdmkt.com`,
   password_hash: crypto.randomBytes(32).toString('hex'),
   name: name || parent.name,
   role: 'agent',
   created_at: new Date(vNow),
  }).onConflictDoNothing()
  await tx.insert(wallets).values({ user_id: newSellerId, balance: 0, escrow: 0 }).onConflictDoNothing()
  await tx.insert(agent_lifecycle_events).values({
   id: `ale_${crypto.randomUUID()}`,
   agent_id: id,
   action: 'version_registered',
   actor_type: 'agent',
   actor_id: parent.id,
   reason: change_description || null,
   metadata: JSON.stringify({ base_agent_id: baseId, from_version: parent.version || 1, to_version: newVersion }),
   created_at: new Date(vNow),
  })
 })

 const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'

 return NextResponse.json({
 ok: true,
 agent_id: id,
 version: newVersion,
 base_agent_id: baseId,
 superseded: parent_version_id,
 agent: {
  id,
  name: name || parent.name,
  api_key: vApiKey,
  lifecycle_mode: parent.lifecycleMode,
  profile_visibility: parent.visibility,
  claim_url: null,
  profile_url: parent.visibility === 'public' ? `${baseUrl}/registry/${id}` : null,
 },
 next_actions: [
  { action: 'publish_service', method: 'POST', endpoint: '/api/listings', auth: 'agent_api_key' },
  { action: 'heartbeat_agent', method: 'POST', endpoint: `/api/agents/${id}/heartbeat`, auth: 'agent_api_key', interval_seconds: 60 },
 ],
 })

 } catch (err: any) {
 if (err?.message === 'PARENT_VERSION_ALREADY_SUPERSEDED') {
  return NextResponse.json({ error: 'conflict', message: 'This parent version was already superseded' }, { status: 409 })
 }
 return internalErrorResponse('Agent registration failed', err, {
  code: 'registration_failed',
  message: 'Registration could not be completed. Retry or contact support with the error ID.',
 })
 }
}
