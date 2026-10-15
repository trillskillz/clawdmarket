import { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { isValidUUID } from '@/lib/validation'
import { purchasingResult } from '@/lib/organization-purchasing-api'
import { PurchasingError } from '@/lib/organization-purchasing-transaction'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { originalContractFundingInput, inspectOriginalContractFunding } from '@/lib/contract-original-funding-reference'
import { fundOriginalOrganizationContract } from '@/lib/organization-contract-funding'
import { readWithLocalContentionRecovery } from '@/lib/local-sqlite-read'
import { NewPaymentsPausedError } from '@/lib/payment-control'
import { CreditError } from '@/lib/account-credit'
import { BuyerSpendPolicyError } from '@/lib/buyer-spend-policy'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { ContractSettlementError } from '@/lib/contract-settlement'
import { SellerRailError } from '@/lib/seller-payment-rails'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; authorizationId: string }> }
async function run(req: NextRequest, context: Context, mutation: boolean) {
  try {
    if (process.env.CONTRACTS_V1 === 'false') return purchasingResult({ error: 'Contracts feature disabled' }, 404)
    const actor = await resolveRequestPrincipal(req), { id, authorizationId } = await context.params
    if (!actor) return purchasingResult({ error: 'Unauthorized' }, 401)
    if (mutation && actor.usesCookieAuth && !validateCsrf(req)) return purchasingResult({ error: 'CSRF validation failed' }, 403)
    if (!isValidUUID(id) || !isValidUUID(authorizationId)) return purchasingResult({ error: 'Invalid original funding scope' }, 400)
    if (!mutation) {
      const entries = Object.fromEntries(req.nextUrl.searchParams)
      if (req.nextUrl.searchParams.size !== Object.keys(entries).length) return purchasingResult({ error: 'Repeated original reference' }, 400)
      const query = z.object({ client_reference: originalContractFundingInput.shape.client_reference }).strict().parse(entries)
      return purchasingResult(await readWithLocalContentionRecovery(source => inspectOriginalContractFunding(source, id, authorizationId, actor.userId, query.client_reference)))
    }
    if (req.nextUrl.searchParams.size) return purchasingResult({ error: 'Unexpected funding query' }, 400)
    const result = await fundOriginalOrganizationContract(id, authorizationId, actor.userId, await readBoundedJson(req, 16384))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  } catch (error) {
    if (error instanceof PurchasingError || error instanceof ArtifactError || error instanceof NewPaymentsPausedError || error instanceof SellerRailError) return purchasingResult({ error: error.message, code: error.code }, error.status)
    if (error instanceof CreditError) return purchasingResult({ error: error.message, code: error.code }, error.status)
    if (error instanceof BuyerSpendPolicyError || error instanceof AgentSpendPolicyError || error instanceof ContractSettlementError) return purchasingResult({ error: error.message, code: error.code }, 409)
    if (error instanceof z.ZodError) return purchasingResult({ error: 'Invalid bounded original funding request' }, 400)
    console.error('Original reviewed contract funding unavailable', error instanceof Error ? error.name : 'unknown')
    return purchasingResult({ error: 'Original funding unavailable; inspect the saved reference before retrying' }, 503)
  }
}
export const POST = (req: NextRequest, context: Context) => run(req, context, true)
export const GET = (req: NextRequest, context: Context) => run(req, context, false)
