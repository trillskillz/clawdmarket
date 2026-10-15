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
