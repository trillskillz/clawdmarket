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
export async function getBalance(userId: string) {
  const wallet = await getOrCreateWallet(userId);
  return {
    balance: wallet.balance,
    escrow: wallet.escrow,
    available: wallet.balance,
  };
}
