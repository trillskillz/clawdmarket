import { NextRequest, NextResponse } from 'next/server'
import { purchasingApi } from './organization-purchasing-api'
import { PurchasingError } from './organization-purchasing-transaction'
import { WorkflowApprovalError } from './workflow-approval'
import { RouteMandateError } from './route-payment-mandate'

export function organizationRouteApi(request: NextRequest, mutation: boolean, run: (actor: string) => Promise<NextResponse>) {
  return purchasingApi(request, mutation, async actor => {
    try { return await run(actor) }
    catch (error) {
      if (error instanceof RouteMandateError || error instanceof WorkflowApprovalError) throw new PurchasingError(error.code, error.status)
      throw error
    }
  })
}
