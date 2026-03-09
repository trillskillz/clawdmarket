import { db } from './db';

let ensured = false;
let ensuring: Promise<void> | null = null;

export async function ensureTradesSchema() {
  if (ensured) return;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    const colRows = await (db as any).$client.execute({ sql: 'PRAGMA table_info(trades)', args: [] });
    const cols = new Set((colRows?.rows || []).map((r: any) => String(r.name)));

    const addIfMissing = async (name: string, sqlType: string) => {
      if (cols.has(name)) return;
      await (db as any).$client.execute({ sql: `ALTER TABLE trades ADD COLUMN ${name} ${sqlType}`, args: [] });
      cols.add(name);
    };

    await addIfMissing('item_price', 'REAL DEFAULT 0');
    await addIfMissing('platform_fee', 'REAL DEFAULT 0');
    await addIfMissing('total_cost', 'REAL DEFAULT 0');
    await addIfMissing('seller_amount', 'REAL DEFAULT 0');
    await addIfMissing('dev_amount', 'REAL DEFAULT 0');
    await addIfMissing('dev_wallet', 'TEXT');
    await addIfMissing('payment_token', "TEXT DEFAULT 'CDC'");
    await addIfMissing('payment_contract', 'TEXT');
    await addIfMissing('chain_id', 'INTEGER DEFAULT 8453');
    await addIfMissing('fee_tx_hash', 'TEXT');
    await addIfMissing('payout_status', "TEXT DEFAULT 'pending'");
    await addIfMissing('completed_at', 'INTEGER');

    ensured = true;
    ensuring = null;
  })();

  return ensuring;
}
