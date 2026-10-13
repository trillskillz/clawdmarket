import 'server-only'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { organization_provider_shares, service_definitions } from './schema'
import { canonicalContract } from './structured-verification'
import { privateProviderAccess } from './organization-private-providers'
import { purchasingServiceHash } from './organization-purchasing'
import { PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'

type Share = typeof organization_provider_shares.$inferSelect
export type FrozenProviderShare = {
  id: string; service_id: string; organization_id: string; organization_owner_id: string;
  provider_owner_id: string; provider_agent_id: string; team_id: string | null;
  offer_reference: string; accept_reference: string; request_hash: string; accept_hash: string; expires_at: string; accepted_at: string;
  consent_hash: string
}
export function freezeProviderShare(share: Share): FrozenProviderShare {
  const offerHash=createHash('sha256').update(JSON.stringify({serviceId:share.service_id,actor:share.provider_owner_id,version:1,client_reference:share.client_reference,organization_id:share.organization_id,team_id:share.team_id,expires_at:share.expires_at.toISOString()})).digest('hex')
  if (share.request_hash !== offerHash) throw new PurchasingError('ORGANIZATION_ROUTE_PRIVATE_CONSENT_CHANGED')
  if (!share.accept_hash || !share.accepted_at || !share.accept_reference) throw new PurchasingError('PROVIDER_SHARE_CONSENT_MISSING')
  const original = {id:share.id,service_id:share.service_id,organization_id:share.organization_id,
    organization_owner_id:share.organization_owner_id,provider_owner_id:share.provider_owner_id,
    provider_agent_id:share.provider_agent_id,team_id:share.team_id,offer_reference:share.client_reference,accept_reference:share.accept_reference,request_hash:share.request_hash,
    accept_hash:share.accept_hash,expires_at:share.expires_at.toISOString(),accepted_at:share.accepted_at.toISOString()}
  return {...original,consent_hash:createHash('sha256').update(canonicalContract(original)).digest('hex')}
}
export async function validateFrozenProviderShare(source: PurchasingSource, consent: FrozenProviderShare,
  buyerId: string, organizationId: string, services: {id:string;seller_id:string;contract_hash:string}[]) {
  const [service] = await source.select().from(service_definitions).where(eq(service_definitions.id,consent.service_id)).limit(1)
  const contract = services.find(value=>value.id===consent.service_id)
  if (!service || !contract || contract.seller_id !== service.seller_id || contract.contract_hash !== purchasingServiceHash(service)
    || service.visibility !== 'organization' || consent.organization_id !== organizationId)
    throw new PurchasingError('ORGANIZATION_ROUTE_PRIVATE_SCOPE_CHANGED')
  const share = await privateProviderAccess(service,buyerId,consent.id,source)
  if (!share || canonicalContract(freezeProviderShare(share)) !== canonicalContract(consent))
    throw new PurchasingError('ORGANIZATION_ROUTE_PRIVATE_CONSENT_CHANGED')
  return share
}
