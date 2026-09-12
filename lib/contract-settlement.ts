import { and, eq, sql } from 'drizzle-orm';
import { transactions, wallets } from '@/lib/schema';
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

  const locked = await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} - ${totalDebit}`,
      escrow: sql`${wallets.escrow} + ${params.sellerAmount}`,
    })
    .where(and(eq(wallets.user_id, params.buyerId), sql`${wallets.balance} >= ${totalDebit}`))
    .returning({ user_id: wallets.user_id });

  if (locked.length === 0) {
    throw new ContractSettlementError('Insufficient balance to fund contract', 'INSUFFICIENT_BALANCE');
  }

  await tx.insert(transactions).values({
    from_user_id: params.buyerId,
    to_user_id: null,
    amount: params.sellerAmount,
    type: 'escrow_lock',
    reference_id: params.contractId,
    memo: 'Contract funds locked in escrow',
  });

  if (params.feeAmount > 0) {
    if (params.feeRecipientId) {
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${params.feeAmount}` })
        .where(eq(wallets.user_id, params.feeRecipientId));
    }
    await tx.insert(transactions).values({
      from_user_id: params.buyerId,
      to_user_id: params.feeRecipientId,
      amount: params.feeAmount,
      type: 'fee',
      reference_id: params.contractId,
      memo: 'Contract marketplace fee',
    });
  }
}

export async function refundContractFunds(
  tx: any,
  params: { contractId: string; buyerId: string; amount: number; milestoneId?: string },
) {
  validateEscrowAmount(params.amount);
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
