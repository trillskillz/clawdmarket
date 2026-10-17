import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { service_definitions } from './schema'
import { agentWorkerPresence, getAgentAvailability } from './agent-presence'
import { payoutAddressForUser } from './external-settlement'
import { sellerPaymentRails } from './seller-payment-rails'
import { selectMarketplaceRail } from './payment-rail-selection'
import { getPaymentReadiness } from './payment-config'
import { getNewPaymentControl } from './payment-control'
import { serviceDefinitionDto } from './service-definitions'
import { PUBLIC_LISTING_SELLER_WHERE_SQL } from './listing-visibility'
import { referenceFleetPaidServicePublicationLocked } from './reference-fleet-control'
import type { AgentCredentialScope } from './agent-credential-scopes'

type Agent = { id: string; status: string; claim_code: unknown; claimed_at: unknown; last_seen_at: unknown;
  worker_state: unknown; worker_last_seen_at: unknown; owner_linked: unknown; account_banned: unknown }
type Blocker = { code: string; scope: 'activation' | 'worker' | 'seller' | 'buyer'; action: string }

/** Projection of existing identity, payout, offer and policy authorities. Never
 * persists readiness or grants authorization, funding or worker presence. */
export async function agentOnboarding(agent: Agent, scopes: AgentCredentialScope[]) {
  const id = String(agent.id), principal = `user_agent_${id}`
  const active = agent.status === 'active', banned = Boolean(agent.account_banned)
  const [payout, preferences, control, serviceRows, listingRows, publicationLocked] = await Promise.all([
    payoutAddressForUser(principal), sellerPaymentRails(principal), getNewPaymentControl(),
    db.select().from(service_definitions).where(eq(service_definitions.seller_id, principal)),
    db.$client.execute({ sql: `SELECT COUNT(*) AS n FROM listings WHERE seller_id=? AND status='active' AND ${PUBLIC_LISTING_SELLER_WHERE_SQL}`, args: [principal] }),
    referenceFleetPaidServicePublicationLocked(id),
  ])
  const rails = getPaymentReadiness()
  const selectedRail = control.paused ? null : selectMarketplaceRail('auto', rails, Boolean(payout), preferences.supported_payment_rails)
  const offers = await Promise.all(serviceRows.map(row => serviceDefinitionDto(row, principal, false, [])))
  const listings = Number(listingRows.rows[0]?.n || 0)
  const purchasableServices = publicationLocked ? 0 : offers.filter(offer => offer.readiness.purchasable).length
  const worker = agentWorkerPresence(agent.status, agent.worker_state, agent.worker_last_seen_at)
  const blockers: Blocker[] = []
  if (!active) blockers.push({ code: agent.claim_code && !agent.claimed_at ? 'OWNER_CLAIM_REQUIRED' : 'AGENT_INACTIVE', scope: 'activation', action: agent.claim_code && !agent.claimed_at ? 'request_owner_claim' : 'contact_support' })
  if (banned) blockers.push({ code: 'ACCOUNT_RESTRICTED', scope: 'activation', action: 'contact_support' })
  if (worker.available !== true) blockers.push({ code: worker.state === 'busy' ? 'WORKER_BUSY' : 'NO_ACTIVE_WORKER', scope: 'worker', action: 'configure_worker' })
  if (!listings && !serviceRows.some(row => row.status === 'active')) blockers.push({ code: 'NO_PUBLISHED_SERVICE', scope: 'seller', action: 'publish_service' })
  if (!selectedRail) blockers.push({ code: control.paused ? 'PAYMENTS_PAUSED' : !payout && preferences.supported_payment_rails.some(rail => rail === 'mpp' || rail === 'evm') ? 'PAYOUT_NOT_CONFIGURED' : 'PAYMENT_RAIL_UNAVAILABLE', scope: 'seller', action: control.paused ? 'check_payment_status' : !payout ? 'configure_payout' : 'review_payment_rails' })
  if (publicationLocked) blockers.push({ code: 'REFERENCE_FLEET_PAID_SERVICES_LOCKED', scope: 'seller', action: 'contact_operator' })
  if (serviceRows.some(row => row.status === 'active') && !purchasableServices) {
    for (const code of new Set(offers.flatMap(offer => offer.readiness.blocking_reasons))) blockers.push({ code, scope: 'seller', action: 'review_service' })
  }
  if (!scopes.includes('payments:write')) blockers.push({ code: 'PAYMENT_SCOPE_REQUIRED', scope: 'buyer', action: 'request_scoped_credential' })
  if (control.paused || ![rails.credit, rails.ledger, rails.mpp, rails.evm].some(rail => rail.enabled)) blockers.push({ code: control.paused ? 'PAYMENTS_PAUSED' : 'PAYMENT_RAIL_UNAVAILABLE', scope: 'buyer', action: 'check_payment_status' })
  return {
    registered: true,
    authenticated: true,
    readiness_state: 'observed' as const,
    // First blocker in dependency order (activation, worker, seller, buyer).
    next_action: blockers[0]?.action ?? null,
    activation_state: active ? 'active' : agent.claim_code && !agent.claimed_at ? 'pending_claim' : 'inactive',
    ownership_state: agent.owner_linked ? 'linked' : 'unverified',
    api_availability: getAgentAvailability(agent.status, agent.last_seen_at),
    worker_available: worker.available,
    worker_presence: worker,
    seller_ready: active && !banned && !publicationLocked && Boolean(selectedRail) && (listings > 0 || purchasableServices > 0),
    buyer_ready: active && !banned && !blockers.some(blocker => blocker.scope === 'buyer'),
    seller: { scope: 'public_checkout_prerequisites', published_listings: listings, published_services: serviceRows.filter(row => row.status === 'active').length,
      purchasable_services: purchasableServices, payout_configured: Boolean(payout), supported_payment_rails: preferences.supported_payment_rails,
      selected_payment_rail: selectedRail, immediately_executable: worker.available === true, settlement_disclosure: preferences.settlement_disclosure },
    buyer: { scope: 'checkout_prerequisites_only', purchase_authorization: 'required_per_order', funding: 'not_checked', spend_policy: '/api/agents/usage' },
    blockers,
  }
}
