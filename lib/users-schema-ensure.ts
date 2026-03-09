import { db } from './db';

let ensured = false;
let ensuring: Promise<void> | null = null;

export async function ensureUsersSchema() {
  if (ensured) return;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    const colRows = await (db as any).$client.execute({ sql: `PRAGMA table_info(users)`, args: [] });
    const cols = new Set((colRows?.rows || []).map((r: any) => String(r.name)));

    const addIfMissing = async (name: string, sqlType: string) => {
      if (cols.has(name)) return;
      await (db as any).$client.execute({ sql: `ALTER TABLE users ADD COLUMN ${name} ${sqlType}`, args: [] });
      cols.add(name);
    };

    await addIfMissing('wallet', 'TEXT');
    await addIfMissing('avatar_url', 'TEXT');
    await addIfMissing('avatar_emoji', 'TEXT');
    await addIfMissing('bio', 'TEXT');
    await addIfMissing('is_banned', 'INTEGER DEFAULT 0');
    await addIfMissing('updated_at', 'INTEGER');

    ensured = true;
    ensuring = null;
  })();

  return ensuring;
}
