import { createHash } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { password_reset_tokens, users } from '@/lib/schema';

const RESET_TTL_MS = 15 * 60 * 1000;

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function storeResetToken(token: string, userId: string) {
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.delete(password_reset_tokens).where(lt(password_reset_tokens.expires_at, now));
    await tx.delete(password_reset_tokens).where(eq(password_reset_tokens.user_id, userId));
    await tx.insert(password_reset_tokens).values({
      token_hash: tokenHash(token),
      user_id: userId,
      expires_at: now + RESET_TTL_MS,
      created_at: now,
    });
  });
}

export async function revokeResetToken(token: string) {
  await db.delete(password_reset_tokens).where(eq(password_reset_tokens.token_hash, tokenHash(token)));
}

export async function resetPasswordWithToken(token: string, passwordHash: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const hash = tokenHash(token);
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .delete(password_reset_tokens)
      .where(and(eq(password_reset_tokens.token_hash, hash), gt(password_reset_tokens.expires_at, Date.now())))
      .returning({ userId: password_reset_tokens.user_id });
    if (!claimed) return false;
    const updated = await tx.update(users).set({ password_hash: passwordHash })
      .where(eq(users.id, claimed.userId)).returning({ id: users.id });
    if (updated.length !== 1) throw new Error('Password reset account is missing');
    await tx.delete(password_reset_tokens).where(eq(password_reset_tokens.user_id, claimed.userId));
    return true;
  });
}
