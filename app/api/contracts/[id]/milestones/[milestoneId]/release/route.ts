import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { contracts } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { isValidUUID } from '@/lib/validation'
import { PurchasingError } from '@/lib/organization-purchasing-transaction'
import { purchasingResult } from '@/lib/organization-purchasing-api'
import { readWithLocalContentionRecovery } from '@/lib/local-sqlite-read'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { releaseOriginalContractCredit } from '@/lib/contract-original-credit-release'
import { CreditError } from '@/lib/account-credit'
import { ContractSettlementError } from '@/lib/contract-settlement'

export const dynamic = 'force-dynamic'
const enabled = process.env.CONTRACTS_V1 !== 'false'

/** Exact original buyer release. The older hashless mark_paid PATCH stays blocked. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; milestoneId: string }> }) {
  try {
    if (!enabled) return purchasingResult({ error: 'Contracts feature disabled' }, 404)
    const actor = await resolveRequestPrincipal(req), { id, milestoneId } = await params
    if (!actor) return purchasingResult({ error: 'Unauthorized' }, 401)
    if (actor.usesCookieAuth && !validateCsrf(req)) return purchasingResult({ error: 'CSRF validation failed' }, 403)
    if (!isValidUUID(id) || !isValidUUID(milestoneId) || req.nextUrl.searchParams.size) return purchasingResult({ error: 'Invalid original release scope' }, 400)
    const [participant] = await readWithLocalContentionRecovery(source => source.select({ buyer: contracts.buyer_id, seller: contracts.seller_id })
      .from(contracts).where(eq(contracts.id, id)).limit(1))
    if (!participant || ![participant.buyer, participant.seller].includes(actor.userId)) return purchasingResult({ error: 'Original contract not found' }, 404)
    const result = await releaseOriginalContractCredit(id, milestoneId, actor.userId, await readBoundedJson(req, 16384))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  } catch (error) {
    if (error instanceof PurchasingError || error instanceof ArtifactError) return purchasingResult({ error: error.message, code: error.code }, error.status)
    if (error instanceof CreditError || error instanceof ContractSettlementError) return purchasingResult({ error: 'Original credit posting is inconsistent; operator review required', code: 'CONTRACT_ORIGINAL_CREDIT_POSTING_UNAVAILABLE' }, 409)
    if (error instanceof z.ZodError) return purchasingResult({ error: 'Invalid exact original release' }, 400)
    // Do not log private financial inputs through a wrapped SQL statement.
    console.error('Original contract credit release unavailable', error instanceof Error ? error.name : 'unknown')
    return purchasingResult({ error: 'Original release unavailable; inspect its saved reference before retrying' }, 503)
  }
}
