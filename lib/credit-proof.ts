export type CreditDeposit = {
  id: string; client_reference: string; user_id: string; amount_minor: number; payer: string; treasury: string; token: string; chain_id: number;
  state: 'pending' | 'confirmed'; created: boolean; token_amount: string; tx_hash: string | null; expires_at: string;
}
export function creditDepositMessage(intent: Pick<CreditDeposit, 'id' | 'user_id' | 'chain_id' | 'token' | 'treasury' | 'amount_minor'>, txHash: string) {
  return ['ClawdMarket USDC account deposit v1', `Intent: ${intent.id}`, `Account: ${intent.user_id}`, `Chain: ${intent.chain_id}`, `Token: ${intent.token}`, `Treasury: ${intent.treasury}`, `Amount cents: ${intent.amount_minor}`, `Transaction: ${txHash.toLowerCase()}`].join('\n')
}
