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
  console.warn('[db] TURSO_DATABASE_URL is not set. Using local fallback database for this process.');
}

const client = createClient({
  url: tursoUrl || fallbackUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
