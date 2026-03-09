import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from './db';
import { users, api_keys } from './schema';
import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { isUserBanned } from './agent-moderation';
import { ensureUsersSchema } from './users-schema-ensure';

const JWT_SECRET = process.env.JWT_SECRET!;
const BCRYPT_ROUNDS = 12;

export interface JWTPayload {
  userId: string;
  email: string;
  role: 'human' | 'agent';
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateJWT(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export async function generateApiKey(): Promise<string> {
  const key = `clawd_${crypto.randomUUID().replace(/-/g, '')}`;
  return key;
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function getKeyPrefix(key: string): string {
  // Return first 8 characters for quick filtering
  return key.substring(0, Math.min(8, key.length));
}

export async function authenticateRequest(authHeader: string | null): Promise<{
  userId: string;
  role: 'human' | 'agent';
  email?: string;
} | null> {
  await ensureUsersSchema();

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);

  // Try JWT first (humans)
  const jwtPayload = verifyJWT(token);
  if (jwtPayload) {
    if (await isUserBanned(jwtPayload.userId)) return null;
    return { userId: jwtPayload.userId, role: jwtPayload.role, email: jwtPayload.email };
  }

  // Try API key (agents)
  if (token.startsWith('clawd_')) {
    const prefix = getKeyPrefix(token);
    
    // Filter by prefix first (fast)
    const matchingKeys = await db.select()
      .from(api_keys)
      .where(eq(api_keys.key_prefix, prefix));
    
    for (const apiKey of matchingKeys) {
      const isValid = await verifyApiKey(token, apiKey.key_hash);
      if (isValid) {
        // Update last_used timestamp
        await db.update(api_keys)
          .set({ last_used: new Date() })
          .where(eq(api_keys.id, apiKey.id));
        
        // Get user info
        const [user] = await db.select()
          .from(users)
          .where(eq(users.id, apiKey.user_id));
        
        if (user) {
          if (await isUserBanned(user.id)) return null;
          return { userId: user.id, role: user.role, email: user.email };
        }
      }
    }
  }

  return null;
}

export async function getSession(): Promise<{ user: { id: string; role: 'human' | 'agent'; email: string } } | null> {
  const cookieStore = cookies();
  const headerStore = headers();

  const bearer = headerStore.get('authorization');
  const cookieToken = cookieStore.get('auth-token')?.value;
  const authHeader = bearer || (cookieToken ? `Bearer ${cookieToken}` : null);

  const auth = await authenticateRequest(authHeader);
  if (!auth) return null;

  const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user) return null;

  return {
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
    },
  };
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be at most 128 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}
