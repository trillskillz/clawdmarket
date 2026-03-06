import { db } from './db';
import { wallets, transactions } from './schema';
import { and, eq, sql } from 'drizzle-orm';
import {
  MAX_ESCROW_AMOUNT,
  MAX_TRANSFER_AMOUNT,
  WalletGuardError,
  validateEscrowAmount,
  validateTransferAmount,
} from './wallet-guards';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Starting balance for new users (faucet removed) */
export const FAUCET_AMOUNT = 0;
/** Ecosystem fee on trades (3%) */
export const ECOSYSTEM_FEE_RATE = 0.03;
/** Treasury address (null = system/burn) */
export const TREASURY_USER_ID = null;
// ─── Errors ───────────────────────────────────────────────────────────────────

export class WalletError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'WalletError';
  }
}

// ─── Wallet CRUD ──────────────────────────────────────────────────────────────

/**
 * Get or create a wallet for a user.
 */
export async function getOrCreateWallet(userId: string) {
  const [existing] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, userId));

  if (existing) return existing;

  // Create wallet with zero starting balance (no faucet)
  const [wallet] = await db
    .insert(wallets)
    .values({ user_id: userId, balance: 0, escrow: 0 })
    .returning();

  return wallet;
}

/**
 * Get wallet balance (returns { balance, escrow, available }).
 */
export async function getBalance(userId: string) {
  const wallet = await getOrCreateWallet(userId);
  return {
    balance: wallet.balance,
    escrow: wallet.escrow,
    available: wallet.balance - wallet.escrow,
  };
}

// ─── Escrow Flow ──────────────────────────────────────────────────────────────

/**
 * Lock funds in escrow when a trade is initiated.
 * Deducts from buyer's available balance into escrow.
 */
export async function escrowLock(buyerId: string, amount: number, tradeId: string) {
  try {
    validateEscrowAmount(amount);
  } catch (e) {
    if (e instanceof WalletGuardError) throw new WalletError(e.message, e.code);
    throw e;
  }

  await getOrCreateWallet(buyerId);

  await db.transaction(async (tx) => {
    const debitRows = await tx
      .update(wallets)
      .set({ escrow: sql`${wallets.escrow} + ${amount}` })
      .where(and(eq(wallets.user_id, buyerId), sql`(${wallets.balance} - ${wallets.escrow}) >= ${amount}`))
      .returning({ user_id: wallets.user_id });

    if (debitRows.length === 0) {
      throw new WalletError('Insufficient balance for escrow lock', 'INSUFFICIENT_BALANCE');
    }

    await tx.insert(transactions).values({
      from_user_id: buyerId,
      to_user_id: null,
      amount,
      type: 'escrow_lock',
      reference_id: tradeId,
      memo: `Escrow locked for trade`,
    });
  });
}

/**
 * Release escrow on trade completion.
 * Moves funds from buyer → seller (minus fee) and buyer → treasury (fee).
 */
export async function escrowRelease(
  buyerId: string,
  sellerId: string,
  amount: number,
  fee: number,
  tradeId: string,
) {
  if (amount <= 0 || fee < 0 || fee > amount) {
    throw new WalletError('Invalid escrow release amounts', 'INVALID_AMOUNT');
  }

  const sellerReceives = amount - fee;
  await getOrCreateWallet(buyerId);
  await getOrCreateWallet(sellerId);

  await db.transaction(async (tx) => {
    const buyerRows = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} - ${amount}`,
        escrow: sql`${wallets.escrow} - ${amount}`,
      })
      .where(and(eq(wallets.user_id, buyerId), sql`${wallets.escrow} >= ${amount}`, sql`${wallets.balance} >= ${amount}`))
      .returning({ user_id: wallets.user_id });

    if (buyerRows.length === 0) {
      throw new WalletError('Escrow release failed: insufficient escrow or balance', 'INSUFFICIENT_ESCROW');
    }

    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${sellerReceives}` })
      .where(eq(wallets.user_id, sellerId));

    await tx.insert(transactions).values({
      from_user_id: buyerId,
      to_user_id: sellerId,
      amount: sellerReceives,
      type: 'escrow_release',
      reference_id: tradeId,
      memo: `Trade completed — seller receives ${sellerReceives.toFixed(2)} $CLAWD`,
    });

    if (fee > 0) {
      await tx.insert(transactions).values({
        from_user_id: buyerId,
        to_user_id: null,
        amount: fee,
        type: 'fee',
        reference_id: tradeId,
        memo: `Ecosystem fee: ${fee.toFixed(2)} $CLAWD (${(ECOSYSTEM_FEE_RATE * 100).toFixed(0)}%)`,
      });
    }
  });
}

/**
 * Refund escrow on trade dispute/cancellation.
 * Returns locked funds to buyer's available balance.
 */
export async function escrowRefund(buyerId: string, amount: number, tradeId: string) {
  try {
    validateEscrowAmount(amount);
  } catch (e) {
    if (e instanceof WalletGuardError) throw new WalletError(e.message, e.code);
    throw e;
  }

  await getOrCreateWallet(buyerId);

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(wallets)
      .set({ escrow: sql`${wallets.escrow} - ${amount}` })
      .where(and(eq(wallets.user_id, buyerId), sql`${wallets.escrow} >= ${amount}`))
      .returning({ user_id: wallets.user_id });

    if (rows.length === 0) {
      throw new WalletError('Escrow refund failed: insufficient escrow', 'INSUFFICIENT_ESCROW');
    }

    await tx.insert(transactions).values({
      from_user_id: null,
      to_user_id: buyerId,
      amount,
      type: 'escrow_refund',
      reference_id: tradeId,
      memo: `Escrow refunded — trade disputed`,
    });
  });
}

// ─── Direct Transfer ──────────────────────────────────────────────────────────

/**
 * Transfer $CLAWD between users (peer-to-peer).
 */
export async function transfer(
  fromUserId: string,
  toUserId: string,
  amount: number,
  memo?: string,
) {
  try {
    validateTransferAmount(amount);
  } catch (e) {
    if (e instanceof WalletGuardError) throw new WalletError(e.message, e.code);
    throw e;
  }

  if (fromUserId === toUserId) {
    throw new WalletError('Cannot transfer to yourself', 'SELF_TRANSFER');
  }

  await getOrCreateWallet(fromUserId);
  await getOrCreateWallet(toUserId);

  const tx = await db.transaction(async (trx) => {
    const debitRows = await trx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}` })
      .where(and(eq(wallets.user_id, fromUserId), sql`(${wallets.balance} - ${wallets.escrow}) >= ${amount}`))
      .returning({ user_id: wallets.user_id });

    if (debitRows.length === 0) {
      throw new WalletError('Insufficient available balance', 'INSUFFICIENT_BALANCE');
    }

    await trx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}` })
      .where(eq(wallets.user_id, toUserId));

    const [created] = await trx.insert(transactions).values({
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount,
      type: 'transfer',
      memo: memo || `P2P transfer: ${amount.toFixed(2)} $CLAWD`,
    }).returning();

    return created;
  });

  return tx;
}
