import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is required');
  }

  const authToken = process.env['TURSO' + '_AUTH_TOKEN'];
  const client = createClient({ url, authToken });

  const sqlPath = path.resolve(process.cwd(), 'migrations/2026-02-26-agent-env-hardening.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await client.execute(stmt);
  }

  console.log(`Applied migration with ${statements.length} statements: ${sqlPath}`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
