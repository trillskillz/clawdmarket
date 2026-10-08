import { and, eq, sql } from 'drizzle-orm';
import { contracts, credit_entries, transactions, wallets } from '@/lib/schema';
import { changeCredit, reserveCredit } from '@/lib/account-credit';
import { getOrCreateWallet } from '@/lib/wallet';
import { validateEscrowAmount } from '@/lib/wallet-guards';

export class ContractSettlementError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ContractSettlementError';
  }
}

export async function ensureContractWallets(buyerId: string, sellerId: string) {
  await Promise.all([getOrCreateWallet(buyerId), getOrCreateWallet(sellerId)]);
}

async function usesCredit(tx: any, contractId: string) {
  const [contract] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!contract) throw new ContractSettlementError('Contract not found', 'CONTRACT_NOT_FOUND');
  return contract.payment_rail === 'credit';
}

async function distributeCredit(tx: any, params: { contractId: string; buyerId: string; sellerId?: string; amount: number; milestoneId?: string }, buyerAmount: number) {
  const minor = Math.round(params.amount * 100);
  const refund = Math.round(buyerAmount * 100);
  const entries = await tx.select().from(credit_entries).where(and(eq(credit_entries.reference, params.contractId), eq(credit_entries.user_id, params.buyerId)));
  const reservation = entries.find((entry: typeof credit_entries.$inferSelect) => entry.kind === 'purchase');
  const remaining = entries.reduce((total: number, entry: typeof credit_entries.$inferSelect) => total + entry.escrow_delta, 0);
  if (!reservation || !Number.isSafeInteger(minor) || minor <= 0 || refund < 0 || refund > minor || remaining < minor) {
    throw new ContractSettlementError('Contract credit reservation is inconsistent', 'ESCROW_BALANCE_MISMATCH');
  }
  const operation = params.milestoneId || 'refund';
  await changeCredit(tx, params.buyerId, params.contractId, `contract_settlement:${operation}`, refund, -minor);
  if (minor > refund) {
    if (!params.sellerId) throw new ContractSettlementError('Seller is required for credit release', 'SELLER_REQUIRED');
    await changeCredit(tx, params.sellerId, params.contractId, `contract_sale:${operation}`, minor - refund, 0);
  }
}

export async function lockContractFunds(
  tx: any,
  params: {
    contractId: string;
    buyerId: string;
    sellerAmount: number;
    feeAmount: number;
    feeRecipientId: string | null;
  },
) {
  const totalDebit = params.sellerAmount + params.feeAmount;
  validateEscrowAmount(totalDebit);

  if (await usesCredit(tx, params.contractId)) {
    if (!params.feeRecipientId) throw new ContractSettlementError('Fee recipient is required', 'FEE_RECIPIENT_REQUIRED');
    await reserveCredit(tx, { id: params.contractId, buyer: params.buyerId, feeRecipient: params.feeRecipientId,
      total: Math.round(totalDebit * 100), seller: Math.round(params.sellerAmount * 100), fee: Math.round(params.feeAmount * 100) });
    return;
  }
  // Historical wallet escrows can finish, but new funding uses deposited credit.
  throw new ContractSettlementError('New contracts require deposited account balance', 'CONTRACT_FUNDING_UNAVAILABLE');
}

export async function refundContractFunds(
  tx: any,
  params: { contractId: string; buyerId: string; amount: number; milestoneId?: string },
) {
  validateEscrowAmount(params.amount);
  if (await usesCredit(tx, params.contractId)) return distributeCredit(tx, params, params.amount);
  const refunded = await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} + ${params.amount}`,
      escrow: sql`${wallets.escrow} - ${params.amount}`,
    })
    .where(and(eq(wallets.user_id, params.buyerId), sql`${wallets.escrow} >= ${params.amount}`))
    .returning({ user_id: wallets.user_id });

  if (refunded.length === 0) {
    throw new ContractSettlementError('Contract escrow balance is inconsistent', 'ESCROW_BALANCE_MISMATCH');
  }

  await tx.insert(transactions).values({
    from_user_id: null,
    to_user_id: params.buyerId,
    amount: params.amount,
    type: 'escrow_refund',
    reference_id: params.contractId,
    memo: params.milestoneId ? `Contract milestone refund: ${params.milestoneId}` : 'Contract escrow refunded',
  });
}

export async function releaseContractFunds(
  tx: any,
  params: {
    contractId: string;
    milestoneId: string;
    buyerId: string;
    sellerId: string;
    amount: number;
  },
) {
  validateEscrowAmount(params.amount);
  if (await usesCredit(tx, params.contractId)) return distributeCredit(tx, params, 0);
  const released = await tx
    .update(wallets)
    .set({ escrow: sql`${wallets.escrow} - ${params.amount}` })
    .where(and(eq(wallets.user_id, params.buyerId), sql`${wallets.escrow} >= ${params.amount}`))
    .returning({ user_id: wallets.user_id });

  if (released.length === 0) {
    throw new ContractSettlementError('Contract escrow balance is inconsistent', 'ESCROW_BALANCE_MISMATCH');
  }

  await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${params.amount}` })
    .where(eq(wallets.user_id, params.sellerId));

  await tx.insert(transactions).values({
    from_user_id: params.buyerId,
    to_user_id: params.sellerId,
    amount: params.amount,
    type: 'escrow_release',
    reference_id: params.contractId,
    memo: `Contract milestone released: ${params.milestoneId}`,
  });
}

export async function splitContractFunds(
  tx: any,
  params: {
    contractId: string;
    milestoneId: string;
    buyerId: string;
    sellerId: string;
    amount: number;
    sellerPercent: number;
  },
) {
  validateEscrowAmount(params.amount);
  const sellerAmount = Math.round(params.amount * params.sellerPercent) / 100;
  const buyerAmount = Math.round((params.amount - sellerAmount) * 100) / 100;
  if (!Number.isFinite(params.sellerPercent) || params.sellerPercent < 0 || params.sellerPercent > 100) {
    throw new ContractSettlementError('Invalid dispute distribution', 'INVALID_AMOUNT');
  }
  if (await usesCredit(tx, params.contractId)) return distributeCredit(tx, params, buyerAmount);

  const released = await tx
    .update(wallets)
    .set({ escrow: sql`${wallets.escrow} - ${params.amount}` })
    .where(and(eq(wallets.user_id, params.buyerId), sql`${wallets.escrow} >= ${params.amount}`))
    .returning({ user_id: wallets.user_id });
  if (released.length === 0) {
    throw new ContractSettlementError('Contract escrow balance is inconsistent', 'ESCROW_BALANCE_MISMATCH');
  }

  if (sellerAmount > 0) {
    await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${sellerAmount}` }).where(eq(wallets.user_id, params.sellerId));
    await tx.insert(transactions).values({
      from_user_id: params.buyerId,
      to_user_id: params.sellerId,
      amount: sellerAmount,
      type: 'escrow_release',
      reference_id: params.contractId,
      memo: `Contract dispute split for milestone: ${params.milestoneId}`,
    });
  }
  if (buyerAmount > 0) {
    await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${buyerAmount}` }).where(eq(wallets.user_id, params.buyerId));
    await tx.insert(transactions).values({
      from_user_id: null,
      to_user_id: params.buyerId,
      amount: buyerAmount,
      type: 'escrow_refund',
      reference_id: params.contractId,
      memo: `Contract dispute split refund for milestone: ${params.milestoneId}`,
    });
  }
}
