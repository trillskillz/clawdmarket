/** Reduce SQLite write contention within one worker. Database capacity checks remain authoritative across workers. */
const tails = new Map<string, Promise<void>>()

export async function withServiceReservationLock<T>(serviceId: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(serviceId) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  tails.set(serviceId, current)
  await previous
  try {
    return await operation()
  } finally {
    if (tails.get(serviceId) === current) tails.delete(serviceId)
    release()
  }
}
