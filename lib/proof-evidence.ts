export function hasLinkedSettlementEvidence(input: {
  deliveryRecorded: boolean
  paymentRecorded: boolean
  payoutConfirmed: boolean
}) {
  return input.deliveryRecorded && input.paymentRecorded && input.payoutConfirmed
}
