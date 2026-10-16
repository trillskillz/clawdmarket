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
import { submitOriginalReviewedContract } from '@/lib/contract-original-submissions'

export const dynamic = 'force-dynamic'
const enabled = process.env.CONTRACTS_V1 !== 'false'

/** Exact original seller operation. The older hashless PATCH stays blocked. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; milestoneId: string }> }) {
  try {
    if (!enabled) return purchasingResult({ error: 'Contracts feature disabled' }, 404)
    const actor = await resolveRequestPrincipal(req), { id, milestoneId } = await params
    if (!actor) return purchasingResult({ error: 'Unauthorized' }, 401)
    if (actor.usesCookieAuth && !validateCsrf(req)) return purchasingResult({ error: 'CSRF validation failed' }, 403)
    if (!isValidUUID(id) || !isValidUUID(milestoneId) || req.nextUrl.searchParams.size) return purchasingResult({ error: 'Invalid original submission scope' }, 400)
    const [participant] = await readWithLocalContentionRecovery(source => source.select({ buyer: contracts.buyer_id, seller: contracts.seller_id })
      .from(contracts).where(eq(contracts.id, id)).limit(1))
    if (!participant || ![participant.buyer, participant.seller].includes(actor.userId)) return purchasingResult({ error: 'Original contract not found' }, 404)
    const result = await submitOriginalReviewedContract(id, milestoneId, actor.userId, await readBoundedJson(req, 96000))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  } catch (error) {
    if (error instanceof PurchasingError || error instanceof ArtifactError) return purchasingResult({ error: error.message, code: error.code }, error.status)
    if (error instanceof z.ZodError) return purchasingResult({ error: 'Invalid bounded original submission' }, 400)
    // Do not log private artifact JSON through a wrapped SQL statement.
    console.error('Original contract submission unavailable', error instanceof Error ? error.name : 'unknown')
    return purchasingResult({ error: 'Original submission unavailable; inspect its saved reference before retrying' }, 503)
  }
}
