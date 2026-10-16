/** Original draft identity only. Organization review and actual credit funding remain separate. */
export type MilestoneContractDraftInput = {
  client_reference: string
  expires_in_hours?: number
  milestones: Array<{ title: string; amount: number; deadline_in_hours?: number; review_window_hours?: number
    acceptance_spec?: { required_artifacts?: string[]; notes?: string; [key: string]: unknown } }>
} & ({ seller_id: string; listing_id?: string } | { seller_id?: string; listing_id: string })
export type OriginalContractCreation = {
  contract: { id: string; buyer_id: string; seller_id: string; listing_id: string | null; state: string
    payment_rail: 'credit' | 'ledger'; total_amount: number; fee_amount: number; escrow_amount: number
    expires_at: string | null; created_at: string; [key: string]: unknown }
  milestones: Array<{ id: string; contract_id: string; milestone_index: number; title: string; amount: number
    acceptance_spec: string; deadline_at: string | null; review_window_hours: number; state: string; [key: string]: unknown }>
  creation: { client_reference: string; request_hash: string }
  idempotent: boolean
}
export function originalContractCreationReference(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new TypeError('original contract client_reference must be 8 to 128 allowed characters')
  return value
}

export type OriginalContractAcceptanceInput = { version: 1; client_reference: string; submission_id: string; content_hash: string; approve: true }
export type OriginalContractAcceptance = {
  decision: { id: string; contract_id: string; milestone_id: string; submission_id: string; content_hash: string;
    buyer_id: string; client_reference: string; accepted_at: string; kind: 'explicit_buyer_acceptance' }
  selected_submission_id: string | null; applies_to_current_submission: boolean; current_milestone_state: string
  credit_remaining_principal_minor: number; financial_release_performed: false; semantic_accuracy: 'unmeasured'
  idempotent?: boolean; observed_at?: string
}
export type OriginalContractSubmission = {
  contract_id: string; contract_state: string; milestone_id: string; milestone_state: string; selected_submission_id: string | null
  credit_remaining_principal_minor: number; superseded: boolean; observed_at: string; original_requirements: Record<string, unknown>
  settlement_terms?: { rail: 'credit'; redeemable: false; seller_receives: 'nonwithdrawable_account_credit'; upfront_fee_minor: number; refundable_principal_minor: number }
  submission: null | { id: string; content_hash: string; client_reference: string; artifact_bundle: Record<string, unknown>;
    auto_check_result: 'pass' | 'fail' | 'inconclusive'; auto_check_report: Record<string, unknown>;
    authorizes_payment: false; remote_execution_observed: false; semantic_accuracy: 'unmeasured' }
}
export type OriginalContractSubmissionInput = { version: 1; client_reference: string; artifact_bundle: Record<string, unknown> }
export type OriginalContractSubmissionOperation = Omit<OriginalContractSubmission, 'observed_at' | 'original_requirements' | 'submission'> & {
  submission: NonNullable<OriginalContractSubmission['submission']>; idempotent: boolean
}
export type OriginalContractCreditReleaseInput = Omit<OriginalContractAcceptanceInput, 'approve'> & { acceptance_id: string }
export type OriginalContractCreditRelease = {
  release: { id: string; contract_id: string; milestone_id: string; acceptance_id: string; submission_id: string; content_hash: string
    client_reference: string; amount_minor: number; released_at: string; settlement_entry_id: string; sale_entry_id: string
    basis: 'explicit_buyer_acceptance'; rail: 'credit'; seller_receives: 'nonwithdrawable_account_credit' }
  financial_posting_confirmed: true; selected_submission_id: string | null; current_milestone_state: string
  credit_remaining_principal_minor: number; idempotent?: boolean; observed_at?: string
}
export type OriginalContractFundingInput = { version: 1; client_reference: string; authority_hash: string }
export type OrganizationContractDecision = { version: 1; client_reference: string; authority_hash: string; approve: true }
export type OrganizationContractAuthorization = {
  id: string; organization_id: string; contract_id: string; buyer_id: string; team_id: string | null; cost_center: string
  client_reference: string; authority_hash: string; version: 1; state: 'pending' | 'approved' | 'revoked'
  viewer_role: 'owner' | 'reviewer'; approved_at: string | null; revoked_at: string | null; decision: OrganizationContractDecision | null
  review_url: string; funding_available: boolean; funding_api_implemented: true; funding_requires_current_review: true
  terms: { version: 1; original: { contract_id: string; buyer_id: string; seller_id: string; listing_id: string | null
    total_minor: number; fee_minor: number; gross_minor: number; expires_at: string; creation: { client_reference: string; request_hash: string }
    milestones: Array<{ id: string; milestone_index: number; title: string; amount_minor: number; acceptance_spec: Record<string, unknown>
      deadline_at: string | null; review_window_hours: number }> }
    expires_at: string; max_daily_minor: number; max_monthly_minor: number; max_lifetime_minor: number
    payment: { rail: 'credit'; redeemable: false; seller_receives: 'nonwithdrawable_account_credit'; upfront_fee_minor: number; refundable_principal_minor: number }
    explicit_buyer_acceptance: true; automatic_review_window_acceptance: false }
}
export type OriginalContractFunding = { contract: OriginalContractCreation['contract']; milestones: OriginalContractCreation['milestones']
  original_terms: Record<string, unknown>; funding: { id: string; organization_id: string; authorization_id: string; contract_id: string; buyer_id: string
    client_reference: string; request_hash: string; authority_hash: string; created_at: string; gross_minor: number; principal_minor: number
    upfront_fee_minor: number; fee_recipient_id: string; rail: 'credit'; redeemable: false; seller_receives: 'nonwithdrawable_account_credit' }
  credit_remaining_principal_minor: number; observed_at: string; idempotent?: boolean }
export type OriginalContractAdjudication = {
  adjudication: { dispute_id: string; contract_id: string; milestone_id: string; decided_by_account_id: string
    ruling: 'buyer_win' | 'seller_win' | 'split' | 'redo'; split_percent_to_seller: number | null; amount_minor: number
    buyer_refund_minor: number; seller_credit_minor: number; settlement_entry_id: string | null; sale_entry_id: string | null
    resolved_at: string; decision_hash: string; basis: 'admin_adjudication'; rail: 'credit'; seller_receives: 'nonwithdrawable_account_credit' }
  buyer_acceptance_created: false; financial_posting_confirmed: boolean; selected_submission_id: string | null
  current_milestone_state: string; credit_remaining_principal_minor: number; observed_at: string
}
