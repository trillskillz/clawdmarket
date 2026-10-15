import { NextRequest, NextResponse } from 'next/server';
import { eq, or, sql, getTableColumns } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, organization_contract_authorizations } from '@/lib/schema';
import { createContractSchema } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { getPaymentReadiness } from '@/lib/payment-config';
import { requireNewPaymentsOpen, NewPaymentsPausedError } from '@/lib/payment-control';

import { ContractCreationError, createContractDraft, findOriginalContractCreation } from '@/lib/contract-creation';
import { PurchasingError } from '@/lib/organization-purchasing-transaction';
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts';

export const dynamic = 'force-dynamic'

const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';

function creationError(error: any) {
  if (error instanceof ContractCreationError || error instanceof PurchasingError || error instanceof NewPaymentsPausedError || error instanceof ArtifactError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (error?.issues || error?.errors || error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  console.error('Contract creation error:', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (req.nextUrl.searchParams.has('client_reference')) {
    try {
      const original = await findOriginalContractCreation(auth.userId, req.nextUrl.searchParams.get('client_reference')!);
      return NextResponse.json(original ?? { error: 'Original creation not found', code: 'CONTRACT_CREATION_NOT_FOUND' }, {
        status: original ? 200 : 404, headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) { return creationError(error); }
  }
  const requestedPage = Number(req.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 50);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50;
  const participantWhere = or(eq(contracts.buyer_id, auth.userId), eq(contracts.seller_id, auth.userId));
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(participantWhere);
  const total = Number(countRow?.count || 0);
  const rows = await db
    .select({ ...getTableColumns(contracts), review_id: organization_contract_authorizations.id })
    .from(contracts)
    .leftJoin(organization_contract_authorizations, eq(organization_contract_authorizations.contract_id, contracts.id))
    .where(participantWhere)
    .orderBy(sql`${contracts.created_at} desc`)
    .limit(limit)
    .offset((page - 1) * limit);

  return NextResponse.json({
    contracts: rows.map(({ review_id, ...contract }) => ({ ...contract, reviewed_contract: review_id !== null })),
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
    has_more: page * limit < total,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  try {
    const body = await readBoundedJson(req, 65_536);
    // Exact referenced replay precedes fresh readiness/pause/catalog checks. It
    // returns original records only; it never funds or extends an obligation.
    let validated: ReturnType<typeof createContractSchema.parse> | undefined;
    if (body && typeof body === 'object' && Object.hasOwn(body, 'client_reference')) {
      validated = createContractSchema.parse(body);
      const prior = await findOriginalContractCreation(auth.userId, validated.client_reference!, validated);
      if (prior) return NextResponse.json(prior, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!getPaymentReadiness().credit.enabled) {
      return NextResponse.json({ error: 'Deposited account-balance funding is unavailable on this deployment.',
        code: 'CONTRACT_FUNDING_UNAVAILABLE' }, { status: 503 });
    }
    await requireNewPaymentsOpen();
    validated ??= createContractSchema.parse(body);
    const result = await createContractDraft(auth.userId, validated);
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return creationError(error); }
}
