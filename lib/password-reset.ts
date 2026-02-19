const resetTokens = new Map<string, { userId: string; expiresAt: number }>();

export function storeResetToken(token: string, userId: string) {
  resetTokens.set(token, { userId, expiresAt: Date.now() + 15 * 60 * 1000 });
}

export function consumeResetToken(token: string): string | null {
  const entry = resetTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    resetTokens.delete(token);
    return null;
  }
  resetTokens.delete(token);
  return entry.userId;
}
