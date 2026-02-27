import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
};

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is required');

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const drizzleDir = path.resolve(process.cwd(), 'drizzle');
  const journalPath = path.join(drizzleDir, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Missing drizzle journal at: ${journalPath}`);
  }

  const journalRaw = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(journalRaw) as { entries: JournalEntry[] };

  await client.execute(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  let inserted = 0;
  for (const entry of journal.entries) {
    const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
    const query = fs.readFileSync(sqlPath, 'utf8');
    const hash = crypto.createHash('sha256').update(query).digest('hex');

    const existing = await client.execute({
      sql: `SELECT id FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      args: [hash],
    });

    if (existing.rows.length === 0) {
      await client.execute({
        sql: `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        args: [hash, entry.when],
      });
      inserted += 1;
    }
  }

  console.log(`Drizzle baseline complete. Inserted ${inserted} migration record(s).`);
}

main().catch((err) => {
  console.error('Failed to baseline drizzle migrations:', err);
  process.exit(1);
});
