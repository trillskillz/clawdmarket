import 'server-only'
import type { Store } from 'mppx'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mpp_store } from '@/lib/schema'

export const durableMppStore: Store.AtomicStore = {
  async get(key) {
    const [row] = await db.select().from(mpp_store).where(eq(mpp_store.key, key)).limit(1)
    return row ? JSON.parse(row.value) : null
  },
  async put(key, value) {
    await db.insert(mpp_store).values({ key, value: JSON.stringify(value), updated_at: new Date() })
      .onConflictDoUpdate({ target: mpp_store.key, set: { value: JSON.stringify(value), updated_at: new Date() } })
  },
  async delete(key) {
    await db.delete(mpp_store).where(eq(mpp_store.key, key))
  },
  async update(key, fn) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(mpp_store).where(eq(mpp_store.key, key)).limit(1)
      const current = row ? JSON.parse(row.value) : null
      const change = fn(current)
      if (change.op === 'set') {
        await tx.insert(mpp_store).values({ key, value: JSON.stringify(change.value), updated_at: new Date() })
          .onConflictDoUpdate({ target: mpp_store.key, set: { value: JSON.stringify(change.value), updated_at: new Date() } })
      } else if (change.op === 'delete') {
        await tx.delete(mpp_store).where(eq(mpp_store.key, key))
      }
      return change.result
    })
  },
}
