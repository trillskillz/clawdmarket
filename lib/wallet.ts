import { db } from './db';
import { wallets, transactions } from './schema';
import { eq, sql } from 'drizzle-orm';

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
  const wallet = await getOrCreateWallet(buyerId);
  const available = wallet.balance - wallet.escrow;

  if (available < amount) {
    throw new WalletError(
      `Insufficient balance. Available: ${available.toFixed(2)} $CLAWD, required: ${amount.toFixed(2)} $CLAWD`,
      'INSUFFICIENT_BALANCE',
    );
  }

  // Increase escrow hold
  await db
    .update(wallets)
    .set({ escrow: sql`${wallets.escrow} + ${amount}` })
    .where(eq(wallets.user_id, buyerId));

  await db.insert(transactions).values({
    from_user_id: buyerId,
    to_user_id: null,
    amount,
    type: 'escrow_lock',
    reference_id: tradeId,
    memo: `Escrow locked for trade`,
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
  const sellerReceives = amount - fee;

  // Remove from buyer's balance + escrow
  await db
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} - ${amount}`,
      escrow: sql`${wallets.escrow} - ${amount}`,
    })
    .where(eq(wallets.user_id, buyerId));

  // Credit seller
  const sellerWallet = await getOrCreateWallet(sellerId);
  await db
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${sellerReceives}` })
    .where(eq(wallets.user_id, sellerId));

  // Log seller payment
  await db.insert(transactions).values({
    from_user_id: buyerId,
    to_user_id: sellerId,
    amount: sellerReceives,
    type: 'escrow_release',
    reference_id: tradeId,
    memo: `Trade completed — seller receives ${sellerReceives.toFixed(2)} $CLAWD`,
  });

  // Log fee (burned / treasury)
  if (fee > 0) {
    await db.insert(transactions).values({
      from_user_id: buyerId,
      to_user_id: null,
      amount: fee,
      type: 'fee',
      reference_id: tradeId,
      memo: `Ecosystem fee: ${fee.toFixed(2)} $CLAWD (${(ECOSYSTEM_FEE_RATE * 100).toFixed(0)}%)`,
    });
  }
}

/**
 * Refund escrow on trade dispute/cancellation.
 * Returns locked funds to buyer's available balance.
 */
export async function escrowRefund(buyerId: string, amount: number, tradeId: string) {
  await db
    .update(wallets)
    .set({ escrow: sql`${wallets.escrow} - ${amount}` })
    .where(eq(wallets.user_id, buyerId));

  await db.insert(transactions).values({
    from_user_id: null,
    to_user_id: buyerId,
    amount,
    type: 'escrow_refund',
    reference_id: tradeId,
    memo: `Escrow refunded — trade disputed`,
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
  if (amount <= 0) {
    throw new WalletError('Amount must be positive', 'INVALID_AMOUNT');
  }

  if (fromUserId === toUserId) {
    throw new WalletError('Cannot transfer to yourself', 'SELF_TRANSFER');
  }

  const fromWallet = await getOrCreateWallet(fromUserId);
  const available = fromWallet.balance - fromWallet.escrow;

  if (available < amount) {
    throw new WalletError(
      `Insufficient balance. Available: ${available.toFixed(2)} $CLAWD, required: ${amount.toFixed(2)} $CLAWD`,
      'INSUFFICIENT_BALANCE',
    );
  }

  // Debit sender
  await db
    .update(wallets)
    .set({ balance: sql`${wallets.balance} - ${amount}` })
    .where(eq(wallets.user_id, fromUserId));

  // Credit receiver
  await getOrCreateWallet(toUserId);
  await db
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${amount}` })
    .where(eq(wallets.user_id, toUserId));

  const [tx] = await db.insert(transactions).values({
    from_user_id: fromUserId,
    to_user_id: toUserId,
    amount,
    type: 'transfer',
    memo: memo || `P2P transfer: ${amount.toFixed(2)} $CLAWD`,
  }).returning();

  return tx;
}
