import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, agentVersions, agentImprovements } from '@/lib/schema'
import { mppx } from '@/lib/mpp'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

let columnsEnsured = false
async function ensureColumns() {
  if (columnsEnsured) return
  const client = (db as any).$client
  await client.execute(`ALTER TABLE agents ADD COLUMN claim_code TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN claimed_at TEXT`).catch(() => {})
  columnsEnsured = true
}

export async function POST(request: NextRequest) {
  return mppx.session({ amount: '0.01', unitType: 'request' })(handler)(request)
}

async function handler(request: NextRequest) {
 try {
 const body = await request.json()
 const {
 name, description, capabilities, endpoint, owner_address,
 parent_version_id,
 system_prompt,
 tools_config,
 model_id,
 change_description,
 improvement_task_id,
 improved_by_agent_id,
 moltbook_handle,
 } = body

 if (!name) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'name is required' },
 { status: 400 }
 )
 }

 const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 const caps = capabilities
 ? (Array.isArray(capabilities) ? JSON.stringify(capabilities) : JSON.stringify([capabilities]))
 : '[]'

 if (!parent_version_id) {
 await ensureColumns()
 await db.insert(agents).values({
 id,
 name,
 description: description || '',
 capabilities: caps,
 endpoint: endpoint || '',
 owner_address: owner_address || '',
 api_key: `k_${Math.random().toString(36).slice(2)}`,
 status: 'active',
 version: 1,
 baseAgentId: id,
 systemPrompt: system_prompt || null,
 toolsConfig: JSON.stringify(tools_config || []),
 modelId: model_id || null,
 created_at: new Date(),
 })

 // Store moltbook_handle if provided (column added via migration)
 if (moltbook_handle) {
 try {
 await (db as any).$client.execute({
 sql: `UPDATE agents SET moltbook_handle = ? WHERE id = ?`,
 args: [String(moltbook_handle).slice(0, 100), id],
 })
 } catch {}
 }

 // Auto-create a marketplace listing so the agent appears in /api/listings
 await autoCreateListing(id, name, description || '', caps)

 return NextResponse.json({ ok: true, agent_id: id, version: 1 })
 }

 const parent = await db.select().from(agents)
 .where(eq(agents.id, parent_version_id)).get().catch(() => null)

 if (!parent) {
 return NextResponse.json({ error: 'parent_not_found' }, { status: 404 })
 }
 if (parent.owner_address !== owner_address) {
 return NextResponse.json(
 { error: 'forbidden', message: 'owner_address must match parent agent' },
 { status: 403 }
 )
 }

 const newVersion = (parent.version || 1) + 1
 const baseId = parent.baseAgentId || parent.id

 await ensureColumns()
 await db.insert(agents).values({
 id,
 name: name || parent.name,
 description: description || parent.description,
 capabilities: caps || parent.capabilities,
 endpoint: endpoint || parent.endpoint,
 owner_address,
 api_key: `k_${Math.random().toString(36).slice(2)}`,
 status: 'active',
 version: newVersion,
 baseAgentId: baseId,
 parentVersionId: parent_version_id,
 systemPrompt: system_prompt || null,
 toolsConfig: JSON.stringify(tools_config || []),
 modelId: model_id || parent.modelId,
 improvementCount: (parent.improvementCount || 0) + 1,
 improvedByAgentId: improved_by_agent_id || null,
 lastImprovedAt: new Date().toISOString(),
 benchmarkScore: parent.benchmarkScore,
 benchmarkHistory: parent.benchmarkHistory,
 velocityScore: parent.velocityScore,
 created_at: new Date(),
 })

 await db.update(agents)
 .set({ status: 'inactive' })
 .where(eq(agents.id, parent_version_id))

 const versionId = `av_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 await db.insert(agentVersions).values({
 id: versionId,
 agentId: id,
 baseAgentId: baseId,
 version: newVersion,
 systemPrompt: system_prompt || null,
 toolsConfig: JSON.stringify(tools_config || []),
 modelId: model_id || null,
 improvedByAgentId: improved_by_agent_id || null,
 improvementTaskId: improvement_task_id || null,
 changeDescription: change_description || null,
 createdAt: new Date().toISOString(),
 }).catch(() => {})

 const improvId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 await db.insert(agentImprovements).values({
 id: improvId,
 baseAgentId: baseId,
 fromAgentId: parent_version_id,
 toAgentId: id,
 fromVersion: parent.version || 1,
 toVersion: newVersion,
 improvedByAgentId: improved_by_agent_id || 'self',
 improvementTaskId: improvement_task_id || null,
 benchmarkBefore: parent.benchmarkScore || null,
 changeDescription: change_description || null,
 newSystemPrompt: system_prompt || null,
 newToolsConfig: JSON.stringify(tools_config || []),
 createdAt: new Date().toISOString(),
 }).catch(() => {})

 return NextResponse.json({
 ok: true,
 agent_id: id,
 version: newVersion,
 base_agent_id: baseId,
 superseded: parent_version_id,
 })

 } catch (err: any) {
 return NextResponse.json(
 { error: 'registration_failed', detail: err.message },
 { status: 500 }
 )
 }
 }

/**
 * Auto-create a synthetic user + listing so new agents appear in /api/listings.
 * Bridges the agents table (agent registration) with the listings table (marketplace).
 */
async function autoCreateListing(agentId: string, name: string, description: string, capsJson: string) {
 try {
  const client = (db as any).$client
  const syntheticUserId = `user_agent_${agentId}`
  const syntheticEmail = `${agentId}@agent.clawdmkt.com`
  const nowIso = new Date().toISOString()

  // Create synthetic user (listings.seller_id references users.id)
  await client.execute({
   sql: `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at)
         VALUES (?, ?, ?, ?, 'agent', ?)`,
   args: [syntheticUserId, syntheticEmail, crypto.randomBytes(32).toString('hex'), name, nowIso],
  })

  let caps: string[] = []
  try { caps = JSON.parse(capsJson) } catch {}
  const category = deriveCategory(caps)

  await client.execute({
   sql: `INSERT OR IGNORE INTO listings (id, seller_id, category, title, description, price_bankr, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0.01, 'active', ?)`,
   args: [`listing_${agentId}`, syntheticUserId, category, name, description || `Services offered by ${name}`, nowIso],
  })
 } catch (err) {
  // Non-fatal — agent registration succeeds even if listing creation fails
  console.error('[auto-listing]', err)
 }
}

function deriveCategory(caps: string[]): 'compute' | 'skills' | 'data' | 'code' | 'analysis' | 'bounties' | 'other' {
 const joined = caps.join(' ').toLowerCase()
 if (/code|debug|review|smart.?contract|api.?integration/.test(joined)) return 'code'
 if (/data|extract|scraping|pipeline/.test(joined)) return 'data'
 if (/analysis|research|financial|legal|benchmark|eval/.test(joined)) return 'analysis'
 if (/compute|gpu|inference|hosting/.test(joined)) return 'compute'
 if (/bounty|task|improvement/.test(joined)) return 'bounties'
 if (caps.length > 0) return 'skills'
 return 'other'
}
