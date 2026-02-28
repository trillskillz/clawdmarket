import 'dotenv/config';
import { db } from '../lib/db';
import { listings } from '../lib/schema';
import { sql } from 'drizzle-orm';

const TARGET_MIN = 1;
const TARGET_MAX = 1000000000000;

function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  if (inMax === inMin) return outMin;
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

async function run() {
  const rows = await db
    .select({ id: listings.id, price_bankr: listings.price_bankr })
    .from(listings);

  if (rows.length === 0) {
    console.log('No listings found. Nothing to normalize.');
    return;
  }

  const prices = rows.map((r) => Number(r.price_bankr)).filter((n) => Number.isFinite(n));
  const currentMin = Math.min(...prices);
  const currentMax = Math.max(...prices);

  console.log(`Normalizing ${rows.length} listings from [${currentMin}, ${currentMax}] -> [${TARGET_MIN}, ${TARGET_MAX}]`);

  if (currentMin === TARGET_MIN && currentMax === TARGET_MAX) {
    const outOfBounds = prices.filter((p) => p < TARGET_MIN || p > TARGET_MAX).length;
    if (outOfBounds === 0) {
      console.log('Listings already within target bounds. No changes made.');
      return;
    }
  }

  let changed = 0;
  for (const row of rows) {
    const original = Number(row.price_bankr);
    const mapped = Math.round(mapRange(original, currentMin, currentMax, TARGET_MIN, TARGET_MAX));
    const normalized = Math.max(TARGET_MIN, Math.min(TARGET_MAX, mapped));

    if (normalized !== original) {
      await db
        .update(listings)
        .set({ price_bankr: normalized })
        .where(sql`${listings.id} = ${row.id}`);
      changed++;
    }
  }

  const updatedRows = await db.select({ price_bankr: listings.price_bankr }).from(listings);
  const updatedPrices = updatedRows.map((r) => Number(r.price_bankr));
  const updatedMin = Math.min(...updatedPrices);
  const updatedMax = Math.max(...updatedPrices);

  console.log(`Done. Updated ${changed} listing prices.`);
  console.log(`New range: [${updatedMin}, ${updatedMax}]`);
}

run().catch((err) => {
  console.error('Failed to normalize listing prices:', err);
  process.exit(1);
});
