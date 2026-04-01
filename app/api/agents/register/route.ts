import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, agentVersions, agentImprovements } from '@/lib/schema'
import { mppx } from '@/lib/mpp'

let _wrappedHandler: (req: NextRequest) => Promise<NextResponse>

function getHandler() {
  if (!_wrappedHandler) {
    _wrappedHandler = mppx.session({ amount: '0.01', unitType: 'request' })(handler)
  }
  return _wrappedHandler
}

export async function POST(request: NextRequest) {
  return getHandler()(request)
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
 } = body

 if (!name || !capabilities || !endpoint || !owner_address) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'name, capabilities, endpoint, owner_address required' },
 { status: 400 }
 )
 }

 const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 const caps = Array.isArray(capabilities)
 ? JSON.stringify(capabilities)
 : JSON.stringify([capabilities])

 if (!parent_version_id) {
 await db.insert(agents).values({
 id,
 name,
 description: description || null,
 capabilities: caps,
 endpoint,
 owner_address,
 api_key: `k_${Math.random().toString(36).slice(2)}`,
 status: 'active',
 version: 1,
 baseAgentId: id,
 systemPrompt: system_prompt || null,
 toolsConfig: JSON.stringify(tools_config || []),
 modelId: model_id || null,
 created_at: new Date(),
 })

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
