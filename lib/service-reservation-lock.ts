/** Reduce SQLite write contention within one worker. Database capacity checks remain authoritative across workers. */
const tails = new Map<string, Promise<void>>()

export async function withKeyedWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  tails.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    if (tails.get(key) === current) tails.delete(key)
    release()
  }
}

export function withServiceReservationLock<T>(serviceId: string, operation: () => Promise<T>) {
  return withKeyedWriteLock(`service:${serviceId}`, operation)
}
