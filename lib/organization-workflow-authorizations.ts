import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { organizations, organization_agent_assignments, organization_teams, organization_purchasing_roles,
  agent_owners, agents, users, workflows, workflow_nodes, workflow_approvals, workflow_runs, workflow_node_runs, workflow_reservations,
  organization_workflow_authorizations as grants, service_definitions, organization_provider_shares,
  service_orders, trades, route_payment_mandates } from './schema'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { approveWorkflowInTransaction, storedWorkflowContract, workflowApprovalInput } from './workflow-approval'
import { validateOrganizationApprover, purchasingServiceHash } from './organization-purchasing'
import { canonicalContract } from './structured-verification'
import { planOrganizationRouteForReview, routePlanInput, type RouteCandidate } from './route-planning'
import { privateProviderAccess } from './organization-private-providers'
import { freezeProviderShare, validateFrozenProviderShare, type FrozenProviderShare } from './organization-route-private-consent'
import { workflowPlanHash } from './workflow-planning'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { issuePurchaseEvidence } from './organization-purchase-evidence'
import { mandateDto } from './route-payment-mandate'
import { findTradeFundingStep } from './route-funding-steps'
import { money } from './service-order-input'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const units = z.string().regex(/^[1-9][0-9]{0,77}$/)
const fail = (code: string, status = 409): never => { throw new PurchasingError(code,status) }
export const organizationWorkflowInput = z.object({
  version: z.union([z.literal(1),z.literal(2)]), client_reference: reference, workflow_id: z.uuid(), reviewer_role_id: z.uuid(),
  approval: workflowApprovalInput, max_daily: money, max_monthly: money, max_lifetime: money, max_lifetime_chain_fee_units: units,
  private_nodes: z.array(z.object({key:z.string(),provider_share_ids:z.array(z.uuid()).min(1).max(20)}).strict()).max(16).default([]),
}).strict().superRefine((input,ctx) => {
  const payment=input.approval.payment
  if (input.version===1 ? payment.rail!=='evm'||payment.chain_id!==1 : payment.rail!=='mpp'||payment.chain_id!==4217||!('fee_token_address' in payment)||payment.fee_token_address!==payment.token_address)
    ctx.addIssue({code:'custom',message:'Review Ethereum L1 native fees or configured Tempo fee-token units'})
  if (input.approval.nodes.some(node=>node.max_attempts!==1||node.max_retry_minor!==0)
    ||input.approval.max_gross_minor>input.max_daily||input.max_daily>input.max_monthly||input.max_monthly>input.max_lifetime
    ||BigInt(input.approval.max_chain_fee_units)>BigInt(input.max_lifetime_chain_fee_units)
    ||new Set(input.private_nodes.map(node=>node.key)).size!==input.private_nodes.length
    ||input.private_nodes.some(node=>!input.approval.nodes.some(term=>term.key===node.key)||new Set(node.provider_share_ids).size!==node.provider_share_ids.length))
    ctx.addIssue({code:'custom',message:'Review bounded original workflow exposure, distinct consent and no paid retries'})
})
export const organizationWorkflowDecision=z.object({version:z.union([z.literal(1),z.literal(2)]),client_reference:reference,authority_hash:z.string().regex(/^[a-f0-9]{64}$/),approve:z.literal(true)}).strict()
type Grant=typeof grants.$inferSelect
type FrozenNode={key:string;candidates:RouteCandidate[];services:{id:string;seller_id:string;contract_hash:string}[];provider_shares:FrozenProviderShare[]}
type Terms={version:1|2;contract_hash:string;max_daily_minor:number;max_monthly_minor:number;max_lifetime_minor:number;max_lifetime_chain_fee_units:string;nodes:FrozenNode[]}
function identity(row:Grant) { return {organization_id:row.organization_id,workflow_id:row.workflow_id,approval_id:row.approval_id,owner_account_id:row.owner_account_id,buyer_id:row.buyer_id,agent_id:row.agent_id,team_id:row.team_id,cost_center:row.cost_center,reviewer_role_id:row.reviewer_role_id,reviewer_account_id:row.reviewer_account_id,request_hash:row.request_hash} }
function fingerprint(row:Grant,terms:Terms) {return hash({kind:`organization-workflow-authority-v${terms.version}`,...identity(row),terms})}
function frozen(row:Grant):Terms {
  try {const terms:Terms=JSON.parse(row.terms_json)
    if (![1,2].includes(terms.version)||fingerprint(row,terms)!==row.authority_hash||!terms.nodes.length
      ||[terms.max_daily_minor,terms.max_monthly_minor,terms.max_lifetime_minor].some(n=>!Number.isSafeInteger(n)||n<1)||!units.safeParse(terms.max_lifetime_chain_fee_units).success) fail('ORGANIZATION_WORKFLOW_CONTRACT_INVALID')
    return terms
  } catch {return fail('ORGANIZATION_WORKFLOW_CONTRACT_INVALID')}
}
async function organization(id:string,source:PurchasingSource) {
  const [org]=await source.select().from(organizations).where(eq(organizations.id,id)).limit(1)
  if(!org)return fail('ORGANIZATION_NOT_FOUND',404)
  return org
}
async function original(row:Grant,source:PurchasingSource) {
  const terms=frozen(row),[approval]=await source.select().from(workflow_approvals).where(eq(workflow_approvals.id,row.approval_id)).limit(1)
  if(!approval||approval.workflow_id!==row.workflow_id||approval.buyer_id!==row.buyer_id||approval.owner_account_id!==row.owner_account_id||approval.contract_hash!==terms.contract_hash) return fail('ORGANIZATION_WORKFLOW_CONTRACT_INVALID')
  const contract=storedWorkflowContract(approval)
  if(contract.workflow.nodes.length!==terms.nodes.length||terms.nodes.some(node=>!contract.terms.nodes.some(n=>n.key===node.key)))fail('ORGANIZATION_WORKFLOW_CONTRACT_INVALID')
  return {terms,approval,contract}
}
async function access(row:Grant,actor:string,source:PurchasingSource) {
  const org=await organization(row.organization_id,source)
  if(org.owner_account_id===actor)return
  if(row.reviewer_account_id!==actor)fail('ORGANIZATION_WORKFLOW_NOT_FOUND',404)
  const {contract}=await original(row,source)
  await validateOrganizationApprover(source,row.organization_id,row.reviewer_role_id,actor,row.team_id,contract.terms.max_gross_minor)
}
async function current(row:Grant,source:PurchasingSource,approved=true) {
  if(!enterpriseFoundationEnabled())fail('ORGANIZATION_WORKFLOW_DISABLED',503)
  const checked=await original(row,source),org=await organization(row.organization_id,source)
  if(org.owner_account_id!==row.owner_account_id)fail('ORGANIZATION_WORKFLOW_OWNER_CHANGED')
  if(!['pending','approved'].includes(row.state)||approved&&row.state!=='approved')fail('ORGANIZATION_WORKFLOW_APPROVAL_REQUIRED')
  const [workflow]=await source.select().from(workflows).where(eq(workflows.id,row.workflow_id)).limit(1)
  const materialized=await source.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id,row.workflow_id))
  if(!workflow||workflow.state!=='planned'||workflowPlanHash(workflow,materialized)!==checked.approval.plan_hash)fail('ORGANIZATION_WORKFLOW_PLAN_CHANGED')
  if(checked.approval.state!=='approved'||checked.approval.expires_at<=new Date())fail('ORGANIZATION_WORKFLOW_INACTIVE')
  if(row.state==='approved'&&(!row.approved_at||!row.decision_reference||row.decision_hash!==hash({version:checked.terms.version,client_reference:row.decision_reference,authority_hash:row.authority_hash,approve:true})))fail('ORGANIZATION_WORKFLOW_DECISION_INVALID')
  const [assignment]=await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id,row.agent_id)).limit(1)
  const [link]=await source.select().from(agent_owners).where(and(eq(agent_owners.agentId,row.agent_id),eq(agent_owners.userId,row.owner_account_id))).limit(1)
  const [agent]=await source.select().from(agents).where(eq(agents.id,row.agent_id)).limit(1)
  const [owner]=await source.select().from(users).where(eq(users.id,row.owner_account_id)).limit(1)
  if(!assignment||assignment.organization_id!==row.organization_id||assignment.team_id!==row.team_id||assignment.cost_center!==row.cost_center
    ||!link||!agent||agent.status!=='active'||agent.archivedAt||!owner||owner.is_banned||row.buyer_id!==`user_agent_${row.agent_id}`)fail('ORGANIZATION_WORKFLOW_ASSIGNMENT_CHANGED')
  if(row.team_id){const [team]=await source.select().from(organization_teams).where(eq(organization_teams.id,row.team_id)).limit(1);if(!team||team.organization_id!==row.organization_id||team.status!=='active')fail('ORGANIZATION_WORKFLOW_DEPARTMENT_CHANGED')}
  await validateOrganizationApprover(source,row.organization_id,row.reviewer_role_id,row.reviewer_account_id,row.team_id,checked.contract.terms.max_gross_minor)
  for(const node of checked.terms.nodes){
    for(const service of node.services){const [live]=await source.select().from(service_definitions).where(eq(service_definitions.id,service.id)).limit(1)
      if(!live||live.seller_id!==service.seller_id||purchasingServiceHash(live)!==service.contract_hash)fail('ORGANIZATION_WORKFLOW_SERVICE_CHANGED')}
    for(const consent of node.provider_shares)await validateFrozenProviderShare(source,consent,row.buyer_id,row.organization_id,node.services)
  }
  return checked
}
async function dto(row:Grant,source:PurchasingSource,actor:string){const {terms,contract,approval}=await original(row,source)
  return {id:row.id,organization_id:row.organization_id,workflow_id:row.workflow_id,buyer_id:row.buyer_id,team_id:row.team_id,cost_center:row.cost_center,
    client_reference:row.client_reference,version:terms.version,state:row.state,authority_hash:row.authority_hash,terms,contract,
    reviewer_account_id:row.reviewer_account_id,viewer_role:actor===row.reviewer_account_id?'reviewer' as const:'owner' as const,
    approval_id:approval.id,approved_at:row.approved_at,revoked_at:row.revoked_at,
    review_url:`/organizations/${row.organization_id}/workflow-authorizations/${row.id}`,
    decision:row.decision_reference?{version:terms.version,client_reference:row.decision_reference,authority_hash:row.authority_hash,approve:true as const}:null}
}
export async function proposeOrganizationWorkflow(orgId:string,actor:string,input:z.output<typeof organizationWorkflowInput>){return purchasingTransaction(async source=>{
  const org=await organization(orgId,source);if(org.owner_account_id!==actor)fail('ORGANIZATION_NOT_FOUND',404)
  const requestHash=hash(input),[prior]=await source.select().from(grants).where(and(eq(grants.organization_id,orgId),eq(grants.client_reference,input.client_reference))).limit(1)
  if(prior){if(prior.request_hash!==requestHash||prior.owner_account_id!==actor)fail('ORGANIZATION_WORKFLOW_IDEMPOTENCY_CONFLICT');return {authorization:await dto(prior,source,actor),idempotent:true}}
  const [workflow]=await source.select().from(workflows).where(eq(workflows.id,input.workflow_id)).limit(1)
  if(!workflow||!workflow.buyer_id.startsWith('user_agent_'))return fail('WORKFLOW_NOT_FOUND',404)
  const agentId=workflow.buyer_id.slice('user_agent_'.length),[assignment]=await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id,agentId)).limit(1)
  if(!assignment||assignment.organization_id!==orgId)fail('ORGANIZATION_WORKFLOW_ASSIGNMENT_CHANGED')
  const [reviewer]=await source.select().from(organization_purchasing_roles).where(eq(organization_purchasing_roles.id,input.reviewer_role_id)).limit(1)
  if(!reviewer||reviewer.account_id===actor) return fail('ORGANIZATION_WORKFLOW_INDEPENDENT_REVIEW_REQUIRED',403)
  const [existing]=await source.select().from(workflow_approvals).where(eq(workflow_approvals.workflow_id,workflow.id)).limit(1)
  if(existing)fail('ORGANIZATION_WORKFLOW_ALREADY_APPROVED')
  const approved=await approveWorkflowInTransaction(source,workflow.id,actor,input.approval)
  const [approval]=await source.select().from(workflow_approvals).where(eq(workflow_approvals.id,approved.approval.id)).limit(1)
  const contract=storedWorkflowContract(approval),nodes:FrozenNode[]=[]
  for(const terms of contract.terms.nodes){
    const planned=contract.workflow.nodes.find(n=>n.key===terms.key)!,shares=input.private_nodes.find(n=>n.key===terms.key)?.provider_share_ids
    // Only declared reference shape is reviewed; actual upstream artifact identity is frozen after accepted settlement.
    const dependencyInput=Object.fromEntries(terms.dependency_inputs.map(binding=>[binding.target_field,{kind:'workflow_private_artifact_v1',binding_id:'00000000-0000-4000-8000-000000000000',artifact_id:'00000000-0000-4000-8000-000000000000',sha256:'0'.repeat(64),size_bytes:1,media_type:'application/json',delivery_hash:'0'.repeat(64)}]))
    const request=routePlanInput.parse({client_reference:`wf-review:${workflow.id}:${terms.key}`,objective:planned.objective,required_capabilities:planned.required_capabilities,
      input:{...terms.static_input,...dependencyInput},max_budget:{amount:(terms.max_per_attempt_minor/100).toFixed(2),currency:'USD'},deadline_seconds:planned.deadline_seconds,
      verification:terms.verification,provider_requirements:terms.provider_requirements,payment_policy:{allowed_rails:[contract.terms.payment.rail]},retry_policy:{max_attempts:1}})
    const result=await planOrganizationRouteForReview(request,workflow.buyer_id,orgId,actor,shares,source)
    if(!result.candidates.length)fail('ORGANIZATION_WORKFLOW_NO_ELIGIBLE_PROVIDER')
    const services:FrozenNode['services']=[],consents:FrozenProviderShare[]=[]
    for(const candidate of result.candidates){const [service]=await source.select().from(service_definitions).where(eq(service_definitions.id,candidate.service_id)).limit(1)
      services.push({id:service.id,seller_id:service.seller_id,contract_hash:purchasingServiceHash(service)})
      if(shares){const [share]=await source.select().from(organization_provider_shares).where(and(eq(organization_provider_shares.service_id,service.id),inArray(organization_provider_shares.id,shares))).limit(1)
        const accepted=await privateProviderAccess(service,workflow.buyer_id,share?.id,source);if(!accepted||accepted.organization_id!==orgId)return fail('ORGANIZATION_WORKFLOW_PRIVATE_SCOPE_CHANGED');consents.push(freezeProviderShare(accepted))}
    }
    if(shares&&(consents.length!==shares.length||!consents.every(s=>shares.includes(s.id))))fail('ORGANIZATION_WORKFLOW_PRIVATE_SCOPE_CHANGED')
    nodes.push({key:terms.key,candidates:result.candidates,services,provider_shares:consents})
  }
  const terms:Terms={version:input.version,contract_hash:approval.contract_hash,max_daily_minor:input.max_daily,max_monthly_minor:input.max_monthly,max_lifetime_minor:input.max_lifetime,max_lifetime_chain_fee_units:input.max_lifetime_chain_fee_units,nodes}
  const row:Grant={id:randomUUID(),organization_id:orgId,workflow_id:workflow.id,approval_id:approval.id,owner_account_id:actor,buyer_id:workflow.buyer_id,agent_id:agentId,
    team_id:assignment.team_id,cost_center:assignment.cost_center,reviewer_role_id:reviewer.id,reviewer_account_id:reviewer.account_id,client_reference:input.client_reference,
    request_hash:requestHash,authority_hash:'',terms_json:JSON.stringify(terms),state:'pending',created_at:new Date(),approved_at:null,revoked_at:null,decision_reference:null,decision_hash:null}
  row.authority_hash=fingerprint(row,terms);await source.insert(grants).values(row);await current(row,source,false)
  return {authorization:await dto(row,source,actor),idempotent:false}
})}
export async function inspectOrganizationWorkflow(orgId:string,id:string,actor:string){const [row]=await db.select().from(grants).where(and(eq(grants.id,id),eq(grants.organization_id,orgId))).limit(1)
  if(!row) return fail('ORGANIZATION_WORKFLOW_NOT_FOUND',404);await access(row,actor,db);return dto(row,db,actor)}
export async function findOrganizationWorkflow(orgId:string,reference:string,actor:string){const org=await organization(orgId,db);if(org.owner_account_id!==actor)fail('ORGANIZATION_NOT_FOUND',404)
  const [row]=await db.select().from(grants).where(and(eq(grants.organization_id,orgId),eq(grants.client_reference,reference))).limit(1);if(!row)return fail('ORGANIZATION_WORKFLOW_NOT_FOUND',404);return dto(row,db,actor)}
export async function approveOrganizationWorkflow(orgId:string,id:string,actor:string,input:z.output<typeof organizationWorkflowDecision>){return purchasingTransaction(async source=>{
  const [row]=await source.select().from(grants).where(and(eq(grants.id,id),eq(grants.organization_id,orgId))).limit(1);if(!row)return fail('ORGANIZATION_WORKFLOW_NOT_FOUND',404)
  await access(row,actor,source);if(actor!==row.reviewer_account_id||actor===row.owner_account_id)fail('ORGANIZATION_WORKFLOW_REVIEWER_REQUIRED',403)
  if(row.decision_hash){if(row.decision_hash!==hash(input))fail('ORGANIZATION_WORKFLOW_DECISION_CONFLICT');return {authorization:await dto(row,source,actor),idempotent:true}}
  const checked=await current(row,source,false);if(input.authority_hash!==row.authority_hash||input.version!==checked.terms.version)fail('ORGANIZATION_WORKFLOW_REVIEW_CHANGED')
  const [approved]=await source.update(grants).set({state:'approved',decision_reference:input.client_reference,decision_hash:hash(input),approved_at:new Date()}).where(and(eq(grants.id,row.id),eq(grants.state,'pending'))).returning()
  if(!approved) return fail('ORGANIZATION_WORKFLOW_STATE_CHANGED');return {authorization:await dto(approved,source,actor),idempotent:false}
})}
export async function revokeOrganizationWorkflow(orgId:string,id:string,actor:string){return purchasingTransaction(async source=>{const [row]=await source.select().from(grants).where(and(eq(grants.id,id),eq(grants.organization_id,orgId))).limit(1)
  if(!row)return fail('ORGANIZATION_WORKFLOW_NOT_FOUND',404);await access(row,actor,source)
  if(row.state==='revoked')return {authorization:await dto(row,source,actor),idempotent:true}
  const [revoked]=await source.update(grants).set({state:'revoked',revoked_at:new Date()}).where(eq(grants.id,id)).returning();return {authorization:await dto(revoked,source,actor),idempotent:false}
})}
export async function organizationWorkflowAuthority(source:PurchasingSource,workflowId:string,approved=true){const [row]=await source.select().from(grants).where(eq(grants.workflow_id,workflowId)).limit(1)
  return row?{row,...await current(row,source,approved)}:null}
export async function organizationWorkflowPrivateShare(source:PurchasingSource,routeId:string,mandateId:string,service:typeof service_definitions.$inferSelect,buyerId:string){
  const [node]=await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.route_id,routeId)).limit(1);if(!node)return undefined
  const [run]=await source.select().from(workflow_runs).where(eq(workflow_runs.id,node.run_id)).limit(1);if(!run)return fail('ORGANIZATION_WORKFLOW_CONTRACT_INVALID')
  const checked=await organizationWorkflowAuthority(source,run.workflow_id);if(!checked)return undefined
  if(node.mandate_id!==mandateId||run.buyer_id!==buyerId||run.approval_id!==checked.row.approval_id)return fail('ORGANIZATION_WORKFLOW_CHILD_CHANGED')
  const frozenNode=checked.terms.nodes.find(n=>n.key===node.node_key),consent=frozenNode?.provider_shares.find(s=>s.service_id===service.id)
  if(!consent)return undefined;return validateFrozenProviderShare(source,consent,buyerId,checked.row.organization_id,frozenNode!.services)
}
export async function organizationWorkflowPurchaseEvidence(source:PurchasingSource,routeId:string,mandateId:string,service:typeof service_definitions.$inferSelect,totalMinor:number){
  const [node]=await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.route_id,routeId)).limit(1);if(!node)return undefined
  const [run]=await source.select().from(workflow_runs).where(eq(workflow_runs.id,node.run_id)).limit(1);if(!run)return fail('ORGANIZATION_WORKFLOW_CONTRACT_INVALID')
  const checked=await organizationWorkflowAuthority(source,run.workflow_id);if(!checked)return undefined
  const contract=checked.terms.nodes.find(n=>n.key===node.node_key)?.services.find(s=>s.id===service.id)
  if(node.mandate_id!==mandateId||!contract||contract.seller_id!==service.seller_id||contract.contract_hash!==purchasingServiceHash(service))fail('ORGANIZATION_WORKFLOW_CHILD_CHANGED')
  return issuePurchaseEvidence({approvalId:checked.row.id,requestHash:checked.row.authority_hash,buyerId:run.buyer_id,totalMinor,sellerId:service.seller_id,paymentRail:checked.contract.terms.payment.rail})
}

/** Historical exposure is validated against original contracts, without requiring live consent. */
export async function organizationWorkflowExposure(source:PurchasingSource,orgId:string,buyerId:string,payment:ReturnType<typeof mandateDto>['terms']['payment'],currentTradeId=''){
  const rows=await source.select().from(grants).where(and(eq(grants.organization_id,orgId),eq(grants.buyer_id,buyerId))).limit(10001)
  if(rows.length>10000)fail('ORGANIZATION_WORKFLOW_HISTORY_UNAVAILABLE',503)
  let daily=0,monthly=0,lifetime=0,gas=0n,fees=0n
  const now=new Date(),day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),month=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)
  for(const row of rows){const originalContract=await original(row,source),[run]=await source.select().from(workflow_runs).where(eq(workflow_runs.workflow_id,row.workflow_id)).limit(1)
    if(!run)continue
    if(run.approval_id!==row.approval_id||run.contract_hash!==originalContract.approval.contract_hash||run.buyer_id!==buyerId)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID')
    const reservations=await source.select().from(workflow_reservations).where(eq(workflow_reservations.run_id,run.id)).limit(17)
    if(reservations.length>16)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID')
    let gross=0,chainFees=0n
    for(const entry of reservations){const [node]=await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.id,entry.node_run_id)).limit(1)
      const [order]=await source.select().from(service_orders).where(eq(service_orders.id,entry.order_id)).limit(1)
      const [trade]=await source.select().from(trades).where(eq(trades.id,entry.trade_id)).limit(1)
      const [mandate]=await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,entry.mandate_id)).limit(1)
      const step=await findTradeFundingStep(source,entry.trade_id),ceiling=originalContract.contract.terms.nodes.find(n=>n.key===node?.node_key)
      if(!node||!order||!trade||!mandate||!step||!ceiling||entry.attempt_number!==1||entry.route_id!==node.route_id||entry.mandate_id!==node.mandate_id||entry.terms_hash!==node.terms_hash
        ||node.run_id!==run.id||order.trade_id!==trade.id||trade.buyer_id!==buyerId||order.buyer_id!==buyerId||step.order_id!==order.id||step.route_id!==entry.route_id||step.mandate_id!==entry.mandate_id
        ||step.terms_hash!==entry.terms_hash||mandateDto(mandate).terms_hash!==entry.terms_hash||entry.amount_minor!==Math.round(trade.total_cost*100)||entry.amount_minor!==step.amount_minor
        ||entry.chain_fee_units!==ceiling.max_chain_fee_per_attempt_units||!units.safeParse(entry.chain_fee_units).success)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID')
      gross+=entry.amount_minor;chainFees+=BigInt(entry.chain_fee_units);lifetime+=entry.amount_minor
      if(entry.created_at.getTime()>=day)daily+=entry.amount_minor;if(entry.created_at.getTime()>=month)monthly+=entry.amount_minor
      const priorPayment=mandateDto(mandate).terms.payment
      if(priorPayment.rail==='evm'){if(priorPayment.chain_id!==1||priorPayment.max_gas_cost_wei!==entry.chain_fee_units)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID');gas+=BigInt(entry.chain_fee_units)}
      else {if(priorPayment.chain_id!==4217||!('fee_token_address'in priorPayment)||priorPayment.max_fee_token_cost_units!==entry.chain_fee_units)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID')
        if(payment.rail==='mpp'&&'fee_token_address'in payment&&'fee_token_address'in priorPayment&&payment.fee_token_address===priorPayment.fee_token_address)fees+=BigInt(entry.chain_fee_units)}
    }
    if(gross!==run.gross_reserved_minor||chainFees.toString()!==run.chain_fee_reserved_units)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID')
  }
  const [orphan]=await source.all(sql`SELECT s.id FROM route_funding_steps s JOIN workflow_node_runs n ON n.mandate_id=s.mandate_id JOIN workflow_runs r ON r.id=n.run_id JOIN organization_workflow_authorizations a ON a.workflow_id=r.workflow_id
    WHERE a.organization_id=${orgId} AND a.buyer_id=${buyerId} AND s.trade_id<>${currentTradeId}
    AND NOT EXISTS(SELECT 1 FROM workflow_reservations w WHERE w.trade_id=s.trade_id AND w.order_id=s.order_id AND w.node_run_id=n.id) LIMIT 1`)
  if(orphan)fail('ORGANIZATION_WORKFLOW_EXPOSURE_INVALID')
  return {daily,monthly,lifetime,gas,fees}
}
export async function reserveOrganizationWorkflowExposure(source:PurchasingSource,workflowId:string,totalMinor:number,fee:string,tradeId:string){
  const checked=await organizationWorkflowAuthority(source,workflowId);if(!checked)return
  const {readOriginalOrganizationRouteExposure}=await import('./organization-route-authorizations')
  const payment=checked.contract.terms.payment,route=await readOriginalOrganizationRouteExposure(source,checked.row.organization_id,checked.row.buyer_id,payment),workflow=await organizationWorkflowExposure(source,checked.row.organization_id,checked.row.buyer_id,payment,tradeId)
  const { organizationTaskExposure } = await import('./organization-task-authorizations')
  const task = await organizationTaskExposure(source, checked.row.organization_id, checked.row.buyer_id, payment)
  const { organizationListingExposure } = await import('./organization-listing-uses')
  const listing = await organizationListingExposure(source, checked.row.organization_id, checked.row.buyer_id, payment)
  for(const [spent,limit]of [[route.daily+workflow.daily+task.daily+listing.daily,checked.terms.max_daily_minor],[route.monthly+workflow.monthly+task.monthly+listing.monthly,checked.terms.max_monthly_minor],[route.lifetime+workflow.lifetime+task.lifetime+listing.lifetime,checked.terms.max_lifetime_minor]])
    if(!Number.isSafeInteger(spent)||spent<0||spent+totalMinor>limit)fail('ORGANIZATION_WORKFLOW_GROSS_LIMIT')
  const fees=payment.rail==='evm'?route.gas+workflow.gas+task.gas+listing.gas:route.fees+workflow.fees+task.fees+listing.fees
  if(fees+BigInt(fee)>BigInt(checked.terms.max_lifetime_chain_fee_units))fail('ORGANIZATION_WORKFLOW_FEE_LIMIT')
}
export async function isPrivateOrganizationWorkflowRoute(routeId:string){const [node]=await db.select().from(workflow_node_runs).where(eq(workflow_node_runs.route_id,routeId)).limit(1)
  if(!node)return false;const [run]=await db.select().from(workflow_runs).where(eq(workflow_runs.id,node.run_id)).limit(1)
  const [row]=run?await db.select().from(grants).where(eq(grants.workflow_id,run.workflow_id)).limit(1):[]
  return !!row&&frozen(row).nodes.some(n=>n.key===node.node_key&&n.provider_shares.length>0)
}
