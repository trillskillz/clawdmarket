import { db } from './db';
import { wallets } from './schema';
import { eq } from 'drizzle-orm';

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
/** Spendable balances come exclusively from verified deposit-backed credit. */
export async function getBalance(userId: string) {
  const { creditBalance } = await import('./account-credit');
  const credit = await creditBalance(userId);
  return { balance: credit.available_minor / 100, escrow: credit.escrow_minor / 100, available: credit.available_minor / 100 };
}
