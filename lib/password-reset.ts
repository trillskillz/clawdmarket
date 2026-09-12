import { createHash } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { password_reset_tokens } from '@/lib/schema';

const RESET_TTL_MS = 15 * 60 * 1000;

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function storeResetToken(token: string, userId: string) {
  const now = Date.now();
  await db.delete(password_reset_tokens).where(lt(password_reset_tokens.expires_at, now));
  await db.insert(password_reset_tokens).values({
    token_hash: tokenHash(token),
    user_id: userId,
    expires_at: now + RESET_TTL_MS,
    created_at: now,
  });
}

export async function consumeResetToken(token: string): Promise<string | null> {
  const hash = tokenHash(token);
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ userId: password_reset_tokens.user_id })
      .from(password_reset_tokens)
      .where(and(eq(password_reset_tokens.token_hash, hash), gt(password_reset_tokens.expires_at, Date.now())))
      .limit(1);
    if (!entry) return null;
    const deleted = await tx
      .delete(password_reset_tokens)
      .where(eq(password_reset_tokens.token_hash, hash))
      .returning({ tokenHash: password_reset_tokens.token_hash });
    return deleted.length === 1 ? entry.userId : null;
  });
}
