import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

/**
 * Build-safe DB initialization.
 *
 * Next.js can evaluate route modules during `next build` ("collecting page data").
 * If TURSO_DATABASE_URL is missing at build time, hard-failing here breaks deploys
 * before runtime envs are available.
 */
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const fallbackUrl = 'file:./build-fallback.db';

if (!tursoUrl) {
  const isProdRuntime =
    process.env.NODE_ENV === 'production' &&
    process.env.VERCEL === '1' &&
    process.env.NEXT_PHASE !== 'phase-production-build';
  if (isProdRuntime) {
    throw new Error('[db] TURSO_DATABASE_URL is missing in production runtime. Refusing to use fallback database.');
  }

  const key = '__clawdmarket_db_fallback_warned__';
  const g = globalThis as Record<string, unknown>;
  if (!g[key]) {
    console.warn('[db] TURSO_DATABASE_URL is not set. Using local fallback database for this process.');
    g[key] = true;
  }
}

const client = createClient({
  url: tursoUrl || fallbackUrl,
  authToken: process.env['TURSO' + '_AUTH_TOKEN'],
});

export const db = drizzle(client, { schema });
