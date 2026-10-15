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
  submission: null | { id: string; content_hash: string; client_reference: string; artifact_bundle: Record<string, unknown>;
    auto_check_result: 'pass' | 'fail' | 'inconclusive'; auto_check_report: Record<string, unknown>;
    authorizes_payment: false; remote_execution_observed: false; semantic_accuracy: 'unmeasured' }
}
export type OriginalContractAdjudication = {
  adjudication: { dispute_id: string; contract_id: string; milestone_id: string; decided_by_account_id: string
    ruling: 'buyer_win' | 'seller_win' | 'split' | 'redo'; split_percent_to_seller: number | null; amount_minor: number
    buyer_refund_minor: number; seller_credit_minor: number; settlement_entry_id: string | null; sale_entry_id: string | null
    resolved_at: string; decision_hash: string; basis: 'admin_adjudication'; rail: 'credit'; seller_receives: 'nonwithdrawable_account_credit' }
  buyer_acceptance_created: false; financial_posting_confirmed: boolean; selected_submission_id: string | null
  current_milestone_state: string; credit_remaining_principal_minor: number; observed_at: string
}
